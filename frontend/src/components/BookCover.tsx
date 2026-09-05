import React, { useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { SFSymbol } from "@/src/components/ios/Native";
import { pickUsableCoverUrl } from "@/src/lib/kdpTitlePresentation";
import { fallbackAsinCoverUrl } from "@/src/lib/targeting";
import { useReduceMotion, useTheme } from "@/src/lib/theme";

export type BookCoverSize = "xs" | "sm" | "md" | "lg";

export type BookCoverPlaceholder = "book" | "cube" | "auto" | "target" | "category";

const SIZE_MAP = {
  xs: { width: 36, height: 52, radius: 8, icon: 16, spine: 2 },
  sm: { width: 40, height: 58, radius: 9, icon: 17, spine: 2 },
  md: { width: 50, height: 72, radius: 10, icon: 20, spine: 3 },
  lg: { width: 68, height: 98, radius: 12, icon: 26, spine: 3 },
} as const;

function placeholderIcon(kind: BookCoverPlaceholder): "book" | "cube" | "slider.horizontal.3" | "arrow.triangle.branch" | "tag" {
  if (kind === "cube") return "cube";
  if (kind === "auto") return "slider.horizontal.3";
  if (kind === "target") return "arrow.triangle.branch";
  if (kind === "category") return "tag";
  return "book";
}

export function BookCover({
  uri,
  fallbackUri,
  asin,
  size = "md",
  placeholder = "book",
  recyclingKey,
  style,
  accessibilityElementsHidden = true,
}: {
  uri?: string | null;
  fallbackUri?: string | null;
  asin?: string | null;
  size?: BookCoverSize;
  placeholder?: BookCoverPlaceholder;
  recyclingKey?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityElementsHidden?: boolean;
}) {
  const t = useTheme();
  const reduceMotion = useReduceMotion();
  const [failedPrimary, setFailedPrimary] = useState(false);
  const spec = SIZE_MAP[size];

  const primary = useMemo(
    () => pickUsableCoverUrl(uri, fallbackUri),
    [uri, fallbackUri],
  );
  const amazonFallback = useMemo(
    () => pickUsableCoverUrl(fallbackUri, fallbackAsinCoverUrl(asin)),
    [fallbackUri, asin],
  );

  // Recycled list rows change uri/asin — reset sticky failure from the prior row.
  useEffect(() => {
    setFailedPrimary(false);
  }, [uri, fallbackUri, asin, recyclingKey, primary, amazonFallback]);

  const coverUrl = !failedPrimary
    ? primary ?? amazonFallback
    : primary && primary !== amazonFallback
      ? amazonFallback
      : null;

  return (
    <View
      accessibilityElementsHidden={accessibilityElementsHidden}
      importantForAccessibility={accessibilityElementsHidden ? "no-hide-descendants" : "auto"}
      style={[
        styles.shell,
        {
          width: spec.width,
          height: spec.height,
          borderRadius: spec.radius,
          borderCurve: "continuous",
          backgroundColor: t.colors.glass_background,
          borderColor: t.colors.glass_stroke,
        },
        Platform.OS === "ios"
          ? {
              shadowColor: "#1A1423",
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.12,
              shadowRadius: 8,
            }
          : { elevation: 3 },
        style,
      ]}
    >
      {coverUrl ? (
        <Image
          source={{ uri: coverUrl }}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
          transition={reduceMotion ? 0 : 220}
          cachePolicy="memory-disk"
          recyclingKey={recyclingKey ?? coverUrl}
          onError={() => setFailedPrimary(true)}
          accessible={false}
        />
      ) : (
        <LinearGradient
          colors={[t.colors.ambient_top, t.colors.background_tertiary]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFillObject, styles.placeholder]}
        >
          <SFSymbol name={placeholderIcon(placeholder)} size={spec.icon} color={t.colors.text_tertiary} />
        </LinearGradient>
      )}
      <View
        pointerEvents="none"
        style={[
          styles.spine,
          {
            width: spec.spine,
            backgroundColor: coverUrl ? "rgba(0,0,0,0.18)" : t.colors.glass_stroke,
          },
        ]}
      />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(255,255,255,0.22)", "transparent"]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 0.55 }}
        style={styles.sheen}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
  },
  placeholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  spine: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
  },
  sheen: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: "42%",
  },
});
