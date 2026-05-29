export class PublicBookingError extends Error {
  readonly code: "captcha_failed" | "slot_unavailable" | "invalid_time_range";

  constructor(code: PublicBookingError["code"], message: string) {
    super(message);
    this.name = "PublicBookingError";
    this.code = code;
  }
}
