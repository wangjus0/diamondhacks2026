export const BACKGROUND_BLUR_GRACE_PERIOD_MS = 700;

export type VoicePopoverBlurDecisionInput = {
  openedFromBackground: boolean;
  millisecondsSinceShow: number;
};

export function shouldHideVoicePopoverOnBlur({
  openedFromBackground,
  millisecondsSinceShow,
}: VoicePopoverBlurDecisionInput): boolean {
  void millisecondsSinceShow;

  if (!openedFromBackground) {
    return true;
  }

  return false;
}
