import React, { useMemo } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { SubScreen } from "@/src/components/SubScreen";
import { BookCover } from "@/src/components/BookCover";
import { EmptyState, RetryState } from "@/src/components/Primitives";
import { IOSGroupedSection } from "@/src/components/ios/Native";
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { useTheme } from "@/src/lib/theme";
import {
  KDP_LINK_PREVIEW_FOOTER,
  KDP_LINK_PREVIEW_TITLE,
} from "@/src/lib/settingsContract";
import {
  fetchKdpAdsLinkPreview,
  summarizeLinkPreview,
  type LinkPreviewBook,
} from "@/src/lib/kdp/linkPreview";

function BookRow({ book, badge }: { book: LinkPreviewBook; badge?: string }) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: t.colors.separator,
      }}
    >
      <BookCover uri={book.imageUrl} asin={book.asin} size="sm" recyclingKey={book.asin} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[t.typography.body, { color: t.colors.text_primary }]} numberOfLines={2}>
          {book.title || book.asin}
        </Text>
        <Text style={[t.typography.footnote, { color: t.colors.text_secondary }]}>{book.asin}</Text>
      </View>
      {badge ? (
        <Text style={[t.typography.caption1, { color: t.colors.tone_good, fontWeight: "600" }]}>
          {badge}
        </Text>
      ) : null}
    </View>
  );
}

function BookList({
  books,
  empty,
  sharedAsins,
}: {
  books: LinkPreviewBook[];
  empty: string;
  sharedAsins?: Set<string>;
}) {
  const t = useTheme();
  if (!books.length) {
    return (
      <View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
        <Text style={[t.typography.footnote, { color: t.colors.text_secondary }]}>{empty}</Text>
      </View>
    );
  }
  return (
    <>
      {books.map((book) => (
        <BookRow
          key={book.asin}
          book={book}
          badge={sharedAsins?.has(book.asin) ? "Shared" : undefined}
        />
      ))}
    </>
  );
}

export default function KdpLinkPreviewScreen() {
  const t = useTheme();
  const { guestMode, user } = useAuth();
  const { selectedProfileIds, adminFilterUserId } = useApp();
  const viewingCustomer = !!adminFilterUserId;
  const profileKey = useMemo(
    () => [...selectedProfileIds].map(String).sort().join("|"),
    [selectedProfileIds],
  );

  const previewQ = useQuery({
    queryKey: ["kdp-link-preview", user?.id, profileKey],
    queryFn: () =>
      fetchKdpAdsLinkPreview({
        userId: user!.id,
        selectedProfileIds,
      }),
    enabled: !guestMode && !viewingCustomer && !!user?.id,
  });

  const preview = previewQ.data;
  const summary = preview ? summarizeLinkPreview(preview) : null;
  const sharedSet = useMemo(
    () => new Set(preview?.sharedAsins ?? []),
    [preview?.sharedAsins],
  );

  return (
    <SubScreen title={KDP_LINK_PREVIEW_TITLE}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={previewQ.isRefetching}
            onRefresh={() => void previewQ.refetch()}
            tintColor={t.colors.tone_primary}
          />
        }
      >
        {guestMode || viewingCustomer ? (
          <EmptyState
            icon="book-outline"
            title="Sign in required"
            subtitle="Open this page with your seller account to compare helper KDP and Ads books."
          />
        ) : previewQ.isError ? (
          <RetryState
            title="Couldn't load book preview"
            subtitle="Pull to retry."
            onRetry={() => void previewQ.refetch()}
          />
        ) : previewQ.isPending && !preview ? (
          <View style={{ padding: 24 }}>
            <Text style={[t.typography.footnote, { color: t.colors.text_secondary }]}>
              Loading KDP and Ads books…
            </Text>
          </View>
        ) : preview && summary ? (
          <>
            <View style={{ paddingHorizontal: 16, paddingBottom: 12, gap: 4 }}>
              <Text
                style={[
                  t.typography.body,
                  {
                    color:
                      summary.status === "matched"
                        ? t.colors.tone_good
                        : summary.status === "no_overlap"
                          ? t.colors.tone_danger
                          : t.colors.text_secondary,
                    fontWeight: "600",
                  },
                ]}
              >
                {summary.status === "matched"
                  ? "Match"
                  : summary.status === "no_overlap"
                    ? "No overlap"
                    : summary.status === "no_helper"
                      ? "No helper account"
                      : "No Ads profiles"}
              </Text>
              <Text style={[t.typography.footnote, { color: t.colors.text_secondary, lineHeight: 18 }]}>
                {summary.detail}
              </Text>
            </View>

            {preview.sharedBooks.length ? (
              <IOSGroupedSection
                title={`In common (${preview.sharedBooks.length})`}
                footer={KDP_LINK_PREVIEW_FOOTER}
              >
                <BookList books={preview.sharedBooks} empty="No shared ASINs." />
              </IOSGroupedSection>
            ) : (
              <IOSGroupedSection title="In common" footer={KDP_LINK_PREVIEW_FOOTER}>
                <BookList books={[]} empty="No shared sponsored ASINs yet." />
              </IOSGroupedSection>
            )}

            <IOSGroupedSection
              title={
                preview.helperAccountName
                  ? `Helper KDP · ${preview.helperAccountName}`
                  : "Helper KDP"
              }
              footer={
                preview.helperAccountId
                  ? `${preview.kdpBooks.length} title${preview.kdpBooks.length === 1 ? "" : "s"} on the helper-bound shelf (preview cap).`
                  : "Run the iPhone KDP helper while signed into Amazon KDP."
              }
            >
              <BookList
                books={preview.kdpBooks}
                empty="No KDP titles on the helper account yet."
                sharedAsins={sharedSet}
              />
            </IOSGroupedSection>

            {preview.adsProfiles.length ? (
              preview.adsProfiles.map((profile) => (
                <IOSGroupedSection
                  key={profile.profileId}
                  title={`Ads · ${profile.label}`}
                  footer={`${profile.books.length} sponsored ASIN${profile.books.length === 1 ? "" : "s"} in product ads (preview cap).`}
                >
                  <BookList
                    books={profile.books}
                    empty="No product ads with ASINs for this profile yet."
                    sharedAsins={sharedSet}
                  />
                </IOSGroupedSection>
              ))
            ) : (
              <IOSGroupedSection title="Ads profiles">
                <BookList
                  books={[]}
                  empty="Select Amazon Ads profiles on Overview, then pull to refresh."
                />
              </IOSGroupedSection>
            )}
          </>
        ) : null}
      </ScrollView>
    </SubScreen>
  );
}
