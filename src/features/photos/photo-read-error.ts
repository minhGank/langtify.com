// Only transport / server availability failures may retain verified owner pixels.
// Auth, lifecycle, identity and response-validation failures still clear content.
export class PhotoReadTransient extends Error {
  constructor() {
    super('Photo temporarily unavailable.');
  }
}
