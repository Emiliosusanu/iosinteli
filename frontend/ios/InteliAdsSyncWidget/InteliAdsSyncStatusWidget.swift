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
    .description("Verified Gross, Ad spend, Net, and KDP helper sync status.")
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

  /// Financial values are never rendered after their verified cache window.
  /// The widget falls back to sync state instead of presenting stale money.
  private var hasFreshFinancials: Bool {
    guard snapshot.financialsVerified == true, let asOf = snapshot.financialsAsOf else {
      return false
    }
    let age = Date().timeIntervalSince(asOf)
    return age >= -300 && age <= 6 * 60 * 60
  }

  private var periodLabel: String {
    let value = snapshot.financialPeriodLabel?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return value.isEmpty ? "Last 7 days" : value
  }

  private func money(_ value: Double) -> String {
    let symbol = snapshot.currencySymbol.isEmpty ? "$" : snapshot.currencySymbol
    let absValue = abs(value)
    let body: String
    if absValue >= 1_000_000 {
      body = String(format: "%.1fM", absValue / 1_000_000)
    } else if absValue >= 1_000 {
      body = String(format: "%.1fK", absValue / 1_000)
    } else if absValue >= 100 {
      body = String(format: "%.0f", absValue)
    } else {
      body = String(format: "%.2f", absValue)
    }
    return "\(value < 0 ? "−" : "")\(symbol)\(body)"
  }

  private func metric(_ label: String, _ value: Double, color: Color = .white) -> some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(label.uppercased())
        .font(.system(size: 9, weight: .semibold, design: .rounded))
        .foregroundStyle(.white.opacity(0.55))
      Text(money(value))
        .font(.system(size: 15, weight: .bold, design: .rounded))
        .foregroundStyle(color)
        .lineLimit(1)
        .minimumScaleFactor(0.65)
    }
  }

  var body: some View {
    switch family {
    case .systemMedium:
      VStack(alignment: .leading, spacing: 10) {
        HStack(spacing: 8) {
          Text("InteliAds")
            .font(.caption.weight(.bold))
            .foregroundStyle(.white)
          Spacer(minLength: 0)
          Text(hasFreshFinancials ? periodLabel : primary)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.white.opacity(0.62))
            .lineLimit(1)
        }
        if hasFreshFinancials {
          HStack(alignment: .top, spacing: 16) {
            metric("Gross", snapshot.royalties)
            metric("Ad spend", snapshot.adSpend)
            metric("Net", snapshot.net, color: snapshot.net >= 0 ? Color.green : Color.red)
          }
          Spacer(minLength: 0)
          Text(detail)
            .font(.caption2.weight(.medium))
            .foregroundStyle(.white.opacity(0.55))
            .lineLimit(1)
        } else {
          Text(primary)
            .font(.system(size: 22, weight: .bold, design: .rounded))
            .foregroundStyle(.white)
            .lineLimit(1)
          Text(detail)
            .font(.caption.weight(.semibold))
            .foregroundStyle(.white.opacity(0.65))
            .lineLimit(2)
        }
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
        if hasFreshFinancials {
          Text("NET · \(periodLabel)")
            .font(.system(size: 9, weight: .semibold, design: .rounded))
            .foregroundStyle(.white.opacity(0.55))
            .lineLimit(1)
          Text(money(snapshot.net))
            .font(.system(size: 25, weight: .bold, design: .rounded))
            .foregroundStyle(snapshot.net >= 0 ? Color.green : Color.red)
            .lineLimit(1)
            .minimumScaleFactor(0.58)
          Text("Gross \(money(snapshot.royalties)) · Ads \(money(snapshot.adSpend))")
            .font(.system(size: 10, weight: .semibold, design: .rounded))
            .foregroundStyle(.white.opacity(0.65))
            .lineLimit(1)
            .minimumScaleFactor(0.55)
        } else {
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
      }
      .padding(14)
    }
  }
}
