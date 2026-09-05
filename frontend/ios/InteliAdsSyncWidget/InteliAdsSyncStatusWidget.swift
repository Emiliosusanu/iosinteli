import SwiftUI
import WidgetKit

struct InteliAdsSyncStatusWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: InteliAdsWidgetConstants.syncStatusWidgetKind, provider: SyncProvider()) { entry in
      SyncStatusView(entry: entry)
        .containerBackground(for: .widget) {
          LinearGradient(
            colors: [
              Color(red: 0.04, green: 0.09, blue: 0.14),
              Color(red: 0.08, green: 0.14, blue: 0.22),
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
          )
        }
    }
    .configurationDisplayName("InteliAds sync")
    .description("KDP helper sync status and last update.")
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
  }
}

private struct SyncEntry: TimelineEntry {
  let date: Date
  let snapshot: InteliAdsWidgetSnapshot
}

private struct SyncProvider: TimelineProvider {
  func placeholder(in context: Context) -> SyncEntry {
    SyncEntry(date: Date(), snapshot: .empty)
  }

  func getSnapshot(in context: Context, completion: @escaping (SyncEntry) -> Void) {
    completion(SyncEntry(date: Date(), snapshot: InteliAdsWidgetSnapshotStore.load()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<SyncEntry>) -> Void) {
    let now = Date()
    let snapshot = InteliAdsWidgetSnapshotStore.load()
    // Royaltix: ~15 min timeline; 5 min while actively syncing.
    let minutes = snapshot.syncIsActive ? 5 : 15
    let next = Calendar.current.date(byAdding: .minute, value: minutes, to: now)
      ?? now.addingTimeInterval(TimeInterval(minutes * 60))
    completion(Timeline(entries: [SyncEntry(date: now, snapshot: snapshot)], policy: .after(next)))
  }
}

private struct SyncStatusView: View {
  let entry: SyncEntry
  @Environment(\.widgetFamily) private var family

  private var snapshot: InteliAdsWidgetSnapshot { entry.snapshot }

  private var primary: String {
    snapshot.syncIsActive ? snapshot.syncStatus : (snapshot.lastSyncAt == nil ? snapshot.syncStatus : "Ready")
  }

  private var detail: String {
    if let last = snapshot.lastSyncAt {
      let formatter = RelativeDateTimeFormatter()
      formatter.unitsStyle = .abbreviated
      return "Last \(formatter.localizedString(for: last, relativeTo: Date()))"
    }
    return snapshot.syncDetail
  }

  var body: some View {
    switch family {
    case .systemMedium:
      HStack(alignment: .top, spacing: 12) {
        VStack(alignment: .leading, spacing: 6) {
          Text("InteliAds")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.white.opacity(0.7))
          Text(primary)
            .font(.system(size: 22, weight: .bold, design: .rounded))
            .foregroundStyle(.white)
            .lineLimit(2)
            .minimumScaleFactor(0.7)
          Text(detail)
            .font(.caption.weight(.semibold))
            .foregroundStyle(.white.opacity(0.65))
            .lineLimit(2)
        }
        Spacer(minLength: 0)
      }
      .padding(14)
    case .accessoryRectangular, .accessoryInline:
      Text("\(primary) · \(detail)")
        .font(.caption.weight(.semibold))
    default:
      VStack(alignment: .leading, spacing: 8) {
        Text("InteliAds")
          .font(.caption.weight(.semibold))
          .foregroundStyle(.white.opacity(0.7))
        Spacer(minLength: 0)
        Text(primary)
          .font(.system(size: 28, weight: .bold, design: .rounded))
          .foregroundStyle(.white)
          .lineLimit(1)
          .minimumScaleFactor(0.6)
        Text(detail)
          .font(.caption.weight(.semibold))
          .foregroundStyle(.white.opacity(0.68))
          .lineLimit(2)
          .minimumScaleFactor(0.7)
      }
      .padding(14)
    }
  }
}
