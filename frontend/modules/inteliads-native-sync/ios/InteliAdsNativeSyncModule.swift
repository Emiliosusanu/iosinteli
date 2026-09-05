import ExpoModulesCore
#if canImport(WidgetKit)
import WidgetKit
#endif

public class InteliAdsNativeSyncModule: Module {
  public func definition() -> ModuleDefinition {
    Name("InteliAdsNativeSync")

    AsyncFunction("registerAndScheduleAsync") { (force: Bool) in
      InteliAdsBackgroundRefreshManager.shared.register()
      InteliAdsBackgroundRefreshManager.shared.isEnabled = true
      InteliAdsBackgroundRefreshManager.shared.scheduleIfNeeded(force: force)
      return true
    }

    AsyncFunction("scheduleIfNeededAsync") { (force: Bool) in
      InteliAdsBackgroundRefreshManager.shared.scheduleIfNeeded(force: force)
      return true
    }

    AsyncFunction("setEnabledAsync") { (enabled: Bool) in
      InteliAdsBackgroundRefreshManager.shared.isEnabled = enabled
      if enabled {
        InteliAdsBackgroundRefreshManager.shared.scheduleIfNeeded(force: true)
      } else {
        InteliAdsBackgroundRefreshManager.shared.cancel()
      }
      return enabled
    }

    AsyncFunction("getStatusAsync") { () -> [String: Any] in
      InteliAdsBackgroundRefreshManager.shared.statusDictionary()
    }

    AsyncFunction("consumePendingWakeKindAsync") { () -> String? in
      InteliAdsBackgroundRefreshManager.consumePendingWakeKind()
    }

    AsyncFunction("updateSyncSnapshotAsync") { (payload: [String: Any]) in
      let status = (payload["status"] as? String) ?? "Syncing"
      let detail = (payload["detail"] as? String) ?? ""
      let isActive = (payload["isActive"] as? Bool) ?? false
      let progress = payload["progress"] as? Double
      let completedAtMs = payload["completedAtMs"] as? Double
      let completedAt = completedAtMs != nil && completedAtMs! > 0
        ? Date(timeIntervalSince1970: completedAtMs! / 1000.0)
        : nil

      var snapshot = InteliAdsWidgetSnapshotStore.load()
      snapshot.syncStatus = status
      snapshot.syncDetail = detail
      snapshot.syncIsActive = isActive
      snapshot.syncProgress = progress.map { min(1, max(0, $0)) }
      if let completedAt { snapshot.lastSyncAt = completedAt }
      snapshot.updatedAt = Date()

      if let name = payload["accountName"] as? String, !name.isEmpty {
        snapshot.accountName = name
      }
      if let symbol = payload["currencySymbol"] as? String, !symbol.isEmpty {
        snapshot.currencySymbol = symbol
      }
      if let royalties = payload["royalties"] as? Double {
        snapshot.royalties = royalties
      }
      if let adSpend = payload["adSpend"] as? Double {
        snapshot.adSpend = adSpend
      }
      if let net = payload["net"] as? Double {
        snapshot.net = net
      }

      InteliAdsWidgetSnapshotStore.save(snapshot)
#if canImport(WidgetKit)
      InteliAdsWidgetSnapshotStore.reloadTimelines(force: (payload["reload"] as? Bool) ?? true)
#endif
      return true
    }

    AsyncFunction("getSyncSnapshotAsync") { () -> [String: Any] in
      let snap = InteliAdsWidgetSnapshotStore.load()
      return [
        "accountName": snap.accountName,
        "syncStatus": snap.syncStatus,
        "syncDetail": snap.syncDetail,
        "syncProgress": snap.syncProgress as Any,
        "syncIsActive": snap.syncIsActive,
        "lastSyncAtMs": snap.lastSyncAt.map { Int($0.timeIntervalSince1970 * 1000) } as Any,
        "updatedAtMs": snap.updatedAt.map { Int($0.timeIntervalSince1970 * 1000) } as Any,
        "currencySymbol": snap.currencySymbol,
        "royalties": snap.royalties,
        "adSpend": snap.adSpend,
        "net": snap.net,
        "appGroup": InteliAdsWidgetConstants.appGroupIdentifier,
      ]
    }
  }
}
