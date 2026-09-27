import React from "react";
import { Text, View } from "react-native";
import { type Href, useRouter } from "expo-router";
import { DashboardSurface } from "@/src/components/DashboardSurface";
import { PrimaryButton } from "@/src/components/Primitives";
import type { SetupStep } from "@/src/lib/setupState";
import { dashboard, useTheme } from "@/src/lib/theme";

export function SetupNextStepCard({
  step,
  progressLabel,
  onLater,
}: {
  step: SetupStep;
  progressLabel: string;
  onLater?: () => void;
}) {
  const t = useTheme();
  const { push } = useRouter();
  return (
    <DashboardSurface
      testID="home-setup-next"
      tone="attention"
      style={{ marginBottom: dashboard.sectionGap }}
    >
      <Text style={[t.typography.caption1, { color: t.colors.text_tertiary, fontWeight: "600" }]}>
        {progressLabel}
      </Text>
      <Text
        style={[t.typography.headline, { color: t.colors.text_primary, marginTop: 4 }]}
        accessibilityRole="header"
      >
        {step.title}
      </Text>
      <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 6, lineHeight: 18 }]}>
        {step.body}
      </Text>
      <View style={{ marginTop: 12, gap: 8 }}>
        <PrimaryButton
          testID={`setup-next-${step.id}`}
          label={step.cta}
          onPress={() => push(step.href as Href)}
        />
        {step.required || !onLater ? null : (
          <PrimaryButton
            testID={`setup-later-${step.id}`}
            label="Later"
            tone="inactive"
            onPress={onLater}
          />
        )}
      </View>
    </DashboardSurface>
  );
}
