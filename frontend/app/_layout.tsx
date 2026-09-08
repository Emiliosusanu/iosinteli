import React, { useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as SplashScreen from "expo-splash-screen";
import { AuthProvider, useAuth } from "@/src/contexts/AuthContext";
import { AppProvider } from "@/src/contexts/AppContext";
import { SplashVideo } from "@/src/components/SplashVideo";
import { QaBootstrap } from "@/src/components/QaBootstrap";
import { KdpHelperHost } from "@/src/components/KdpHelperHost";
import { hydrateQueryClient, startQueryPersistence } from "@/src/lib/queryPersist";
import { authRedirectTarget } from "@/src/lib/authContract";
import { isSafeNotificationHref, parseNotificationPayload, routeForNotification } from "@/src/lib/notificationContract";
import { resolveDeepLinkHref } from "@/src/lib/deepLinkContract";
import { markPerf } from "@/src/lib/perf";
import { debugIngest } from "@/src/lib/debugIngest";
import * as Linking from "expo-linking";

// Hold the native splash until our JS is mounted, then hand off to the branded React splash.
SplashScreen.preventAutoHideAsync().catch(() => {});
markPerf("js_execution");
markPerf("app.shell");

// Brand hold only. Do not wait for dashboard network. Valid session/cache can paint after this.
const MIN_SPLASH_MS = 400;

// Survives RouteGuard remounts so a consumed tap cannot replay on token refresh.
const handledNotificationIds = new Set<string>();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Same-key hits stay instant via memory + AsyncStorage hydrate.
      // Do NOT reuse a prior query's rows under a new period/profile key —
      // that paints Week numbers under Month labels and wrong entities.
      staleTime: 45_000,
      gcTime: 1000 * 60 * 60 * 6,
      retry: 1,
      // RN has no window focus; AppState handler below refetches on foreground.
      refetchOnWindowFocus: false,
    },
  },
});

/** Pull latest financial reality when returning from background — no stale paint. */
function FinancialForegroundRefetch() {
  useEffect(() => {
    let appState: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener("change", (next) => {
      const wasBackground = appState === "background" || appState === "inactive";
      appState = next;
      if (!wasBackground || next !== "active") return;
      void queryClient.invalidateQueries({
        predicate: (query) => {
          const root = query.queryKey?.[0];
          return typeof root === "string" && (
            root.startsWith("kdp-royalties")
            || root.startsWith("campaign-metrics")
            || root.startsWith("mobile-overview")
            || root.startsWith("products-range")
            || root.startsWith("top-books")
            || root.startsWith("placement-mix")
          );
        },
      });
    });
    return () => sub.remove();
  }, []);
  return null;
}

function RouteGuard({ children }: { children: React.ReactNode }) {
  const { state, user } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (state === "loading") return;
    const next = authRedirectTarget(state, segments as unknown as string[]);
    if (next) router.replace(next as any);
  }, [state, segments, router]);

  // Route once when the user taps a notification. Consume the OS last-response
  // so a later auth remount (token refresh, sign-out/in) cannot replay it.
  useEffect(() => {
    if (state !== "authenticated") return;

    let cancelled = false;
    const navigateFor = (response: Notifications.NotificationResponse | null) => {
      if (!response || cancelled) return;
      const id = response.notification.request.identifier
        || String(response.notification.date ?? "");
      if (!id || handledNotificationIds.has(id)) return;
      handledNotificationIds.add(id);
      const payload = parseNotificationPayload(response.notification.request.content.data);
      const dest = routeForNotification(payload, user?.id ?? null);
      const href = isSafeNotificationHref(dest.href) ? dest.href : resolveDeepLinkHref(dest.href);
      if (href === "/(tabs)" || href === "/(tabs)/campaigns" || href === "/(tabs)/products" || href === "/more/settings") {
        router.replace(href as any);
      } else {
        router.push(href as any);
      }
    };

    Notifications.getLastNotificationResponseAsync()
      .then(async (response) => {
        navigateFor(response);
        try {
          await Notifications.clearLastNotificationResponseAsync();
        } catch {
          // Native module may be missing in some environments.
        }
      })
      .catch(() => {});

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      navigateFor(response);
      Notifications.clearLastNotificationResponseAsync().catch(() => {});
    });
    const linking = Linking.addEventListener("url", ({ url }) => {
      if (cancelled) return;
      const href = resolveDeepLinkHref(url);
      if (href === "/(tabs)" || href === "/(tabs)/campaigns" || href === "/(tabs)/products" || href === "/more/settings") {
        router.replace(href as any);
      } else {
        router.push(href as any);
      }
    });

    return () => {
      cancelled = true;
      sub.remove();
      linking.remove();
    };
  }, [state, router, user?.id]);

  return <>{children}</>;
}

// Shows the animated logo until both: (a) auth state resolved, and
// (b) the minimum brand-moment time has elapsed. Handles cold start / force-kill
// reloads where session hydration takes a moment.
function SplashGate({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  const [minElapsed, setMinElapsed] = useState(false);
  const [reactSplashReady, setReactSplashReady] = useState(false);
  const hidNative = useRef(false);

  const dismissNative = () => {
    if (!hidNative.current) {
      hidNative.current = true;
      SplashScreen.hideAsync().catch(() => {});
    }
  };

  // Hide the native splash once React has painted our branded splash layer.
  useEffect(() => {
    if (reactSplashReady) dismissNative();
  }, [reactSplashReady]);

  // Safety net: ALWAYS dismiss the native splash shortly after mount, even if
  // the React splash layer never reports ready (e.g. a heavy/failed asset).
  // Without this, a stuck native splash shows as a blank/black screen.
  useEffect(() => {
    const guard = setTimeout(dismissNative, 800);
    return () => clearTimeout(guard);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setMinElapsed(true), MIN_SPLASH_MS);
    return () => clearTimeout(id);
  }, []);

  // Auth restore already has an 8s fallback. Splash must not cover Home if
  // that path hangs on getSession/storage. Cached Home is already mounted.
  const [forceReady, setForceReady] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setForceReady(true), 2_500);
    return () => clearTimeout(id);
  }, []);

  const ready = ((state !== "loading" && minElapsed) || forceReady);

  useEffect(() => {
    // #region agent log
    debugIngest("app/_layout.tsx:SplashGate", "splash ready state", { ready, authState: state, minElapsed, forceReady }, "A");
    // #endregion
  }, [ready, state, minElapsed, forceReady]);

  return (
    <>
      {children}
      <SplashVideo visible={!ready} onReady={() => setReactSplashReady(true)} />
    </>
  );
}

export default function RootLayout() {
  // Restore the persisted query cache after mounting so a large/corrupt cache
  // can never block the first React paint. Persistence starts after hydration.
  useEffect(() => {
    let mounted = true;
    let stop: (() => void) | undefined;
    markPerf("cache.hydrate.start");
    hydrateQueryClient(queryClient).finally(() => {
      markPerf("cache.hydrate.end");
      if (!mounted) return;
      stop = startQueryPersistence(queryClient);
    });
    return () => {
      mounted = false;
      stop?.();
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <FinancialForegroundRefetch />
          <AuthProvider>
            <AppProvider>
              <QaBootstrap />
              <KdpHelperHost />
              <SplashGate>
                <RouteGuard>
                  <StatusBar style="auto" translucent />
                  <Stack screenOptions={{ headerShown: false, animation: "slide_from_right", contentStyle: { backgroundColor: "transparent" } }}>
                    <Stack.Screen name="index" />
                    <Stack.Screen name="auth/welcome" />
                    <Stack.Screen name="auth/login" />
                    <Stack.Screen name="auth/signup" />
                    <Stack.Screen name="auth/forgot" />
                    <Stack.Screen name="auth/reset" />
                    <Stack.Screen name="(tabs)" />
                    <Stack.Screen name="campaign/[id]" options={{ headerShown: false, presentation: "card" }} />
                    <Stack.Screen name="product/[asin]" options={{ headerShown: false, presentation: "card" }} />
                    <Stack.Screen name="keyword/[id]" options={{ headerShown: false, presentation: "card" }} />
                    <Stack.Screen name="target/[id]" options={{ headerShown: false, presentation: "card" }} />
                    <Stack.Screen name="search-term/[id]" options={{ headerShown: false, presentation: "card" }} />
                    <Stack.Screen name="more/settings" />
                    <Stack.Screen name="more/notifications" />
                    <Stack.Screen name="more/automation" />
                    <Stack.Screen name="more/rule-create" />
                    <Stack.Screen name="more/accounts" />
                    <Stack.Screen name="more/negative-targeting" />
                    <Stack.Screen name="more/search-terms" />
                    <Stack.Screen name="more/ad-groups" />
                    <Stack.Screen name="more/ad-group/[id]" />
                    <Stack.Screen name="more/rule-history" />
                    <Stack.Screen name="more/rule-detail/[id]" />
                    <Stack.Screen name="more/sync" />
                    <Stack.Screen name="more/data-map" />
                    <Stack.Screen name="more/account" />
                    <Stack.Screen name="more/bid-bot" />
                    <Stack.Screen name="more/kdp-source" />
                    <Stack.Screen name="more/kdp-helper" />
                  </Stack>
                </RouteGuard>
              </SplashGate>
            </AppProvider>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
