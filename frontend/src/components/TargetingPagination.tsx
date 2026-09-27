import React from "react";
import { Pressable, Text, View } from "react-native";
import { targetingPageNumbers } from "@/src/lib/targetingPage";

export function TargetingPagination({
  page,
  totalPages,
  onChange,
  theme: t,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  theme: any;
}) {
  const safeTotal = Math.max(1, totalPages);
  const safePage = Math.max(1, Math.min(page, safeTotal));
  const numbers = targetingPageNumbers(safePage, safeTotal);

  const button = (n: number, label: string, disabled = false) => (
    <Pressable
      key={label}
      testID={`targeting-page-${label}`}
      accessibilityRole="button"
      accessibilityLabel={label === "Previous" || label === "Next" ? `${label} page` : `Page ${n}`}
      accessibilityState={{ selected: label === String(safePage), disabled }}
      disabled={disabled}
      onPress={() => onChange(n)}
      style={{
        minWidth: 44,
        minHeight: 44,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 8,
        borderRadius: 10,
        backgroundColor: label === String(safePage) ? t.colors.tone_primary : "transparent",
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <Text
        style={{
          color: label === String(safePage) ? "#fff" : t.colors.tone_primary,
          fontWeight: "600",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View testID="targeting-pagination" style={{ alignItems: "center", paddingVertical: 6 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center" }}>
        {button(safePage - 1, "Previous", safePage <= 1)}
        {numbers.map((n, i) => (
          <React.Fragment key={n}>
            {i > 0 && n > numbers[i - 1] + 1 ? (
              <Text style={{ color: t.colors.text_secondary, paddingHorizontal: 4 }}>…</Text>
            ) : null}
            {button(n, String(n))}
          </React.Fragment>
        ))}
        {button(safePage + 1, "Next", safePage >= safeTotal)}
      </View>
    </View>
  );
}
