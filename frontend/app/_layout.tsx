import React, { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useColorScheme } from "react-native";
import { AuthProvider, useAuth } from "@/src/contexts/AuthContext";
import { AppProvider } from "@/src/contexts/AppContext";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function RouteGuard({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (state === "loading") return;
    const inAuthGroup = segments[0] === "auth";
    if (state === "unauthenticated" && !inAuthGroup) {
      router.replace("/auth/login");
    } else if (state === "authenticated" && inAuthGroup) {
      router.replace("/(tabs)");
    }
  }, [state, segments, router]);

  return <>{children}</>;
}

export default function RootLayout() {
  const scheme = useColorScheme();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <AppProvider>
              <RouteGuard>
                <StatusBar style={scheme === "dark" ? "light" : "dark"} />
                <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
                  <Stack.Screen name="index" />
                  <Stack.Screen name="auth/login" />
                  <Stack.Screen name="auth/signup" />
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="campaign/[id]" options={{ presentation: "card" }} />
                  <Stack.Screen name="more/settings" />
                  <Stack.Screen name="more/automation" />
                  <Stack.Screen name="more/accounts" />
                  <Stack.Screen name="more/negative-targeting" />
                  <Stack.Screen name="more/search-terms" />
                  <Stack.Screen name="more/ad-groups" />
                  <Stack.Screen name="more/account" />
                </Stack>
              </RouteGuard>
            </AppProvider>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
