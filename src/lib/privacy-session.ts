function nextEpoch(current: number): number {
  if (!Number.isSafeInteger(current) || current < 0 || current === Number.MAX_SAFE_INTEGER) return 1;
  return current + 1;
}

export class PrivacySessionEpochGuard {
  private epoch = 0;
  private transitionToken: number | null = null;

  capture(): number {
    return this.epoch;
  }

  canMutateProfile(): boolean {
    return this.transitionToken === null;
  }

  isTransitioning(): boolean {
    return this.transitionToken !== null;
  }

  beginTransition(): number {
    if (this.transitionToken !== null) throw new Error("A privacy transition is already active.");
    this.epoch = nextEpoch(this.epoch);
    this.transitionToken = this.epoch;
    return this.transitionToken;
  }

  completeTransition(token: number): boolean {
    if (this.transitionToken !== token) return false;
    this.transitionToken = null;
    this.epoch = nextEpoch(this.epoch);
    return true;
  }

  abortTransition(token: number): boolean {
    return this.completeTransition(token);
  }

  replaceSession(): number {
    this.transitionToken = null;
    this.epoch = nextEpoch(this.epoch);
    return this.epoch;
  }
}
