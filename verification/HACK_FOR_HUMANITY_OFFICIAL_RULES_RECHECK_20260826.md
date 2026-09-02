# Hack for Humanity Summer 2026 official-rules recheck — 2026-08-26

Retrieved from the organizer's current public pages on **2026-08-26 EDT**.
This is a requirements note, not an organizer eligibility decision.

## Official sources

- Overview and submission requirements:
  <https://hack-for-humanity-summer-26.devpost.com/>
- Rules and schedule:
  <https://hack-for-humanity-summer-26.devpost.com/rules>
- Health judging guide:
  <https://hack-humanity.web.app/Health%20Judging%20Guide.pdf>
- AI/ML judging guide:
  <https://hack-humanity.web.app/AI-ML%20Judging%20Guide.pdf>
- Design and innovation judging guide:
  <https://hack-humanity.web.app/Design%20and%20Innovation%20Judging%20Guide.pdf>

## Resolved requirements

- Submission closes **September 4, 2026 at 11:45 PM EDT** on the current
  overview. The rules schedule gives the same date and clock time while labeling
  its schedule EST.
- Entrants may work individually or in teams of two to four. Participants must
  be at least 13 and standard territory exceptions apply.
- Development must begin after the August 7, 2026 opening.
- The product must address mental or physical wellbeing.
- The submission must include a GitHub repository containing functioning source
  code and a video of at most four minutes explaining the problem, functionality,
  and how the software was created.
- The published pages reviewed here do not add an explicit hosted-demo, public
  license, or contest-specific AI-tool disclosure requirement. This absence is
  not a waiver of Devpost's general terms or any later organizer update.

## Eligibility blocker requiring organizer clarification

The official rules prohibit development assistance from outside the registered
group. This candidate was materially implemented and tested with an AI coding assistant.
The reviewed official pages do not clarify whether an AI coding assistant is
treated as outside-group assistance. Therefore the project remains **HOLD for
eligibility and submission** until the organizer answers the saved disclosure
question in `docs/ORGANIZER_ELIGIBILITY_QUESTION_DRAFT.md` in writing.

Do not hide, minimize, or recharacterize that assistance in a submission.

## Judging implications

- The health rubric gives equal prominence to domain effectiveness and
  feasibility/safety. The highest band expects meaningful safety controls and
  real-world readiness; this build must not claim clinical validation.
- The AI/ML rubric rewards multi-stage/local inference and rigorous evaluation,
  but also explicit data protection, validation, guardrails, adversarial defense,
  and explainability. Removing the existing safety layer to create an
  “unguarded” companion would conflict with the organizer's published rubric.
- The design rubric rewards polished, intuitive, accessible flows with clear
  focus states and screen-reader support.

## Current evidence boundary

The sealed 0.2.25 owner-test package and its local tests are product evidence.
They do not resolve contest eligibility, provide a public GitHub URL, publish a
video, establish clinical efficacy, or constitute organizer approval.
