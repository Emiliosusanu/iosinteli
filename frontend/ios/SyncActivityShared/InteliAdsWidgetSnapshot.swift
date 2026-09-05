import Foundation

/// Shared with the widget extension (same schema as the Expo module store).
struct InteliAdsWidgetSnapshot: Codable, Hashable {
  var accountName: String
  var syncStatus: String
  var syncDetail: String
  var syncProgress: Double?
  var syncIsActive: Bool
  var lastSyncAt: Date?
  var updatedAt: Date?
  var currencySymbol: String
  var royalties: Double
  var adSpend: Double
  var net: Double

  static let empty = InteliAdsWidgetSnapshot(
    accountName: "InteliAds",
    syncStatus: "Open InteliAds",
    syncDetail: "Open the app to load KDP sync",
    syncProgress: nil,
    syncIsActive: false,
    lastSyncAt: nil,
    updatedAt: nil,
    currencySymbol: "$",
    royalties: 0,
    adSpend: 0,
    net: 0
  )
}

enum InteliAdsWidgetConstants {
  static let appGroupIdentifier = "group.io.inteliads.app"
  static let syncStatusWidgetKind = "InteliAdsSyncStatusWidget"
  static let snapshotKey = "inteliads_widget_snapshot_v1"
}

enum InteliAdsWidgetSnapshotStore {
  private static var defaults: UserDefaults {
    UserDefaults(suiteName: InteliAdsWidgetConstants.appGroupIdentifier) ?? .standard
  }

  static func load() -> InteliAdsWidgetSnapshot {
    guard let data = defaults.data(forKey: InteliAdsWidgetConstants.snapshotKey) else {
      return .empty
    }
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .secondsSince1970
    return (try? decoder.decode(InteliAdsWidgetSnapshot.self, from: data)) ?? .empty
  }
}
