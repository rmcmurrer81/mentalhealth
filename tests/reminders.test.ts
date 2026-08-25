import { describe, expect, it } from "vitest";
import { applyAdherenceSignal, appointmentReminder, extractCarePlans, medicationReminder, mergeAppointmentPlans, mergeMedicationPlans } from "../src/lib/reminders";

describe("adaptive reminders", () => {
  const now = new Date("2026-08-24T09:05:00");

  it("quietly reminds a consistently adherent person", () => {
    const reminder = medicationReminder({ id: "m1", name: "Morning medication", scheduleLabel: "every morning", time: "09:00", adherenceStreak: 12, recentMisses: 0 }, now);
    expect(reminder?.tone).toBe("quiet");
  });

  it("raises visibility after repeated misses without changing instructions", () => {
    const reminder = medicationReminder({ id: "m2", name: "Evening medication", scheduleLabel: "as prescribed at 9:00", time: "09:00", adherenceStreak: 0, recentMisses: 3 }, now);
    expect(reminder?.tone).toBe("attention");
    expect(reminder?.detail).toContain("never changes medical instructions");
  });

  it("does not nag outside the due window", () => {
    const reminder = medicationReminder({ id: "m3", name: "Morning medication", scheduleLabel: "every morning", time: "06:00", adherenceStreak: 1, recentMisses: 0 }, now);
    expect(reminder).toBeNull();
  });

  it("keeps a late-night medication in the reminder window after midnight", () => {
    const reminder = medicationReminder(
      { id: "m4", name: "Night medication", scheduleLabel: "every night at 11:30", time: "23:30", adherenceStreak: 0, recentMisses: 1 },
      new Date("2026-08-25T00:15:00"),
    );
    expect(reminder?.title).toContain("Night medication");
  });

  it("surfaces an appointment within thirty hours", () => {
    const reminder = appointmentReminder({ id: "a1", title: "Doctor appointment", dateTime: "2026-08-25T10:00:00", location: "Clinic" }, now);
    expect(reminder?.title).toContain("tomorrow");
    expect(reminder?.detail).toContain("Clinic");
  });

  it("labels a same-day evening appointment as today even when it is more than twelve hours away", () => {
    const reminder = appointmentReminder(
      { id: "a2", title: "Therapy appointment", dateTime: "2026-08-24T22:00:00" },
      new Date("2026-08-24T08:00:00"),
    );
    expect(reminder?.title).toContain("today");
  });

  it("ignores an invalid appointment date", () => {
    expect(appointmentReminder({ id: "a3", title: "Appointment", dateTime: "not-a-date" }, now)).toBeNull();
  });

  it("turns a user-entered morning medication schedule into a reminder plan", () => {
    const plans = extractCarePlans("I take Sertraline every morning.", now);
    expect(plans.medications[0]).toMatchObject({ name: "Sertraline", scheduleLabel: "every morning", time: "09:00" });
  });

  it("turns a user-entered appointment into a dated reminder plan", () => {
    const plans = extractCarePlans("I have a doctor appointment tomorrow at noon.", now);
    expect(plans.appointments).toHaveLength(1);
    const appointment = new Date(plans.appointments[0].dateTime);
    expect(appointment.getFullYear()).toBe(2026);
    expect(appointment.getMonth()).toBe(7);
    expect(appointment.getDate()).toBe(25);
    expect(appointment.getHours()).toBe(12);
  });

  it("does not invent a reminder time when the user did not provide a schedule", () => {
    const plans = extractCarePlans("I take Sertraline.", now);
    expect(plans.medications).toHaveLength(0);
  });

  it("deduplicates care plans learned more than once", () => {
    const first = extractCarePlans("I take Sertraline every morning.", now);
    const repeated = extractCarePlans("I take Sertraline every morning.", now);
    expect(mergeMedicationPlans(first.medications, repeated.medications)).toHaveLength(1);
    const appointmentFirst = extractCarePlans("I have a therapy appointment tomorrow at noon.", now);
    const appointmentRepeated = extractCarePlans("I have a therapy appointment tomorrow at noon.", now);
    expect(mergeAppointmentPlans(appointmentFirst.appointments, appointmentRepeated.appointments)).toHaveLength(1);
  });

  it("makes a confirmed routine quieter over time without changing the saved schedule", () => {
    let plans = extractCarePlans("I take Sertraline every morning.", now).medications;
    for (let day = 0; day < 8; day += 1) {
      plans = applyAdherenceSignal(plans, "I took Sertraline.", new Date(2026, 7, 24 + day, 9, 5));
    }
    expect(plans[0]).toMatchObject({ adherenceStreak: 8, recentMisses: 0, scheduleLabel: "every morning", time: "09:00" });
    expect(medicationReminder(plans[0], new Date(2026, 7, 31, 9, 5))?.tone).toBe("quiet");
  });

  it("raises reminder visibility after distinct missed days and ignores duplicate reports", () => {
    const base = extractCarePlans("I take Sertraline every morning.", now).medications;
    const first = applyAdherenceSignal(base, "I forgot to take Sertraline.", new Date(2026, 7, 24, 12));
    const duplicate = applyAdherenceSignal(first, "I missed Sertraline.", new Date(2026, 7, 24, 13));
    const second = applyAdherenceSignal(duplicate, "I missed Sertraline.", new Date(2026, 7, 25, 12));
    expect(second[0]).toMatchObject({ adherenceStreak: 0, recentMisses: 2 });
    expect(medicationReminder(second[0], new Date(2026, 7, 26, 9, 5))?.tone).toBe("attention");
  });

  it("does not treat uncertainty, an overdose phrase, or ambiguous multiple plans as adherence", () => {
    const first = extractCarePlans("I take Sertraline every morning.", now).medications;
    const second = extractCarePlans("I take Vitamin D every night.", now).medications;
    const plans = [...first, ...second];
    expect(applyAdherenceSignal(plans, "I forgot whether I took my medication.", now)).toEqual(plans);
    expect(applyAdherenceSignal(plans, "I took 30 pills.", now)).toEqual(plans);
    expect(applyAdherenceSignal(plans, "I took it.", now)).toEqual(plans);
  });

  it("allows a generic check-in when exactly one medication plan exists", () => {
    const plans = extractCarePlans("I take Sertraline every morning.", now).medications;
    expect(applyAdherenceSignal(plans, "I took my medication.", now)[0]).toMatchObject({ adherenceStreak: 1, lastConfirmedDate: "2026-08-24" });
  });
});
