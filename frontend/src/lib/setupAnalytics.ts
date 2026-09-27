/**
 * Setup / onboarding measurement. Events are named facts, not conversion claims.
 * No Amplitude/Segment wiring in this app yet — emit a stable console record.
 */

export const SETUP_EVENTS = {
  onboardingStarted: "onboarding_started",
  onboardingSkipped: "onboarding_skipped",
  signupCompleted: "signup_completed",
  loginCompleted: "login_completed",
  connectionStarted: "connection_started",
  connectionCompleted: "connection_completed",
  connectionFailed: "connection_failed",
  profilesActivated: "profiles_activated",
  firstUsableSync: "first_usable_sync",
  firstRealDataView: "first_real_data_view",
  planViewed: "plan_viewed",
  setupStepAbandoned: "setup_step_abandoned",
} as const;

export type SetupEventName = (typeof SETUP_EVENTS)[keyof typeof SETUP_EVENTS];

export type SetupEventPayload = {
  name: SetupEventName;
  at: string;
  properties: Record<string, string | number | boolean | null>;
};

export function buildSetupEvent(
  name: SetupEventName,
  properties: Record<string, string | number | boolean | null> = {},
  now = new Date(),
): SetupEventPayload {
  return {
    name,
    at: now.toISOString(),
    properties,
  };
}

export function trackSetupEvent(
  name: SetupEventName,
  properties: Record<string, string | number | boolean | null> = {},
): SetupEventPayload {
  const event = buildSetupEvent(name, properties);
  // eslint-disable-next-line no-console
  console.info(`[inteliads:analytics] ${event.name}`, event);
  return event;
}
