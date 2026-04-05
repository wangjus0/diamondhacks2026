export const BACKGROUND_BLUR_GRACE_PERIOD_MS = 700;

export type VoicePopoverBlurDecisionInput = {
  openedFromBackground: boolean;
  millisecondsSinceShow: number;
};

export function shouldHideVoicePopoverOnBlur({
  openedFromBackground,
  millisecondsSinceShow,
}: VoicePopoverBlurDecisionInput): boolean {
  if (!openedFromBackground) {
    return true;
  }

  return millisecondsSinceShow >= BACKGROUND_BLUR_GRACE_PERIOD_MS;
}
