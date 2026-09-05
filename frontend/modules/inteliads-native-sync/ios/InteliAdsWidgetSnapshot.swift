import Foundation
#if canImport(WidgetKit)
import WidgetKit
#endif

/// Shared App Group snapshot — mirrors RoyaltixWidgetSnapshot for sync status + light metrics.
public struct InteliAdsWidgetSnapshot: Codable, Hashable {
  public var accountName: String
  public var syncStatus: String
  public var syncDetail: String
  public var syncProgress: Double?
  public var syncIsActive: Bool
  public var lastSyncAt: Date?
  public var updatedAt: Date?
  public var currencySymbol: String
  public var royalties: Double
  public var adSpend: Double
  public var net: Double

  public static let empty = InteliAdsWidgetSnapshot(
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

public enum InteliAdsWidgetConstants {
  public static let appGroupIdentifier = "group.io.inteliads.app"
  public static let syncStatusWidgetKind = "InteliAdsSyncStatusWidget"
  public static let allWidgetKinds = [syncStatusWidgetKind]
  fileprivate static let snapshotKey = "inteliads_widget_snapshot_v1"
  fileprivate static let reloadTimestampKey = "inteliads_widget_reload_timestamp_v1"
  fileprivate static let activeReloadMinIntervalSeconds: TimeInterval = 15
}

public enum InteliAdsWidgetSnapshotStore {
  private static let lock = NSLock()

  private static var defaults: UserDefaults {
    UserDefaults(suiteName: InteliAdsWidgetConstants.appGroupIdentifier) ?? .standard
  }

  public static func load() -> InteliAdsWidgetSnapshot {
    lock.lock()
    defer { lock.unlock() }
    guard let data = defaults.data(forKey: InteliAdsWidgetConstants.snapshotKey) else {
      return .empty
    }
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .secondsSince1970
    return (try? decoder.decode(InteliAdsWidgetSnapshot.self, from: data)) ?? .empty
  }

  public static func save(_ snapshot: InteliAdsWidgetSnapshot) {
    lock.lock()
    defer { lock.unlock() }
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .secondsSince1970
    guard let data = try? encoder.encode(snapshot) else { return }
    defaults.set(data, forKey: InteliAdsWidgetConstants.snapshotKey)
  }

  public static func updateSync(
    status: String,
    detail: String = "",
    progress: Double? = nil,
    isActive: Bool,
    completedAt: Date? = nil
  ) {
    lock.lock()
    defer { lock.unlock() }
    var snapshot = loadUnlocked()
    snapshot.syncStatus = status
    snapshot.syncDetail = detail
    snapshot.syncProgress = progress.map { min(1, max(0, $0)) }
    snapshot.syncIsActive = isActive
    if let completedAt {
      snapshot.lastSyncAt = completedAt
    }
    snapshot.updatedAt = Date()
    saveUnlocked(snapshot)
  }

  private static func loadUnlocked() -> InteliAdsWidgetSnapshot {
    guard let data = defaults.data(forKey: InteliAdsWidgetConstants.snapshotKey) else {
      return .empty
    }
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .secondsSince1970
    return (try? decoder.decode(InteliAdsWidgetSnapshot.self, from: data)) ?? .empty
  }

  private static func saveUnlocked(_ snapshot: InteliAdsWidgetSnapshot) {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .secondsSince1970
    guard let data = try? encoder.encode(snapshot) else { return }
    defaults.set(data, forKey: InteliAdsWidgetConstants.snapshotKey)
  }

#if canImport(WidgetKit)
  public static func reloadTimelines(force: Bool = false) {
    let now = Date().timeIntervalSince1970
    lock.lock()
    if !force {
      let last = defaults.double(forKey: InteliAdsWidgetConstants.reloadTimestampKey)
      guard now - last >= InteliAdsWidgetConstants.activeReloadMinIntervalSeconds else {
        lock.unlock()
        return
      }
    }
    defaults.set(now, forKey: InteliAdsWidgetConstants.reloadTimestampKey)
    lock.unlock()
    for kind in InteliAdsWidgetConstants.allWidgetKinds {
      WidgetCenter.shared.reloadTimelines(ofKind: kind)
    }
  }
#endif
}
