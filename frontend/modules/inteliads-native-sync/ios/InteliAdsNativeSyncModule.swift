import ExpoModulesCore
import Foundation
import WebKit
#if canImport(WidgetKit)
import WidgetKit
#endif

public class InteliAdsNativeSyncModule: Module {
  @MainActor
  private func cookieHeader(for urlString: String) async -> String {
    guard let url = URL(string: urlString),
          let host = url.host?.lowercased() else {
      return ""
    }

    let cookies: [HTTPCookie] = await withCheckedContinuation { continuation in
      WKWebsiteDataStore.default().httpCookieStore.getAllCookies { values in
        continuation.resume(returning: values)
      }
    }
    let now = Date()
    let requestPath = url.path.isEmpty ? "/" : url.path
    let secureRequest = url.scheme?.lowercased() == "https"

    return cookies
      .filter { cookie in
        let domain = cookie.domain
          .lowercased()
          .trimmingCharacters(in: CharacterSet(charactersIn: "."))
        let domainMatches = host == domain || host.hasSuffix(".\(domain)")
        let pathMatches = requestPath.hasPrefix(cookie.path.isEmpty ? "/" : cookie.path)
        let isCurrent = cookie.expiresDate.map { $0 > now } ?? true
        return domainMatches && pathMatches && isCurrent && (!cookie.isSecure || secureRequest)
      }
      .sorted { $0.path.count > $1.path.count }
      .map { "\($0.name)=\($0.value)" }
      .joined(separator: "; ")
  }

  private func normalizedApnsEnvironment(_ value: Any?) -> String? {
    guard let raw = value as? String else { return nil }
    switch raw.lowercased() {
    case "development", "sandbox":
      return "sandbox"
    case "production":
      return "production"
    default:
      return nil
    }
  }

  /// Reads the public provisioning profile bundled with development/ad-hoc builds.
  /// TestFlight/App Store builds either report production here or omit the profile,
  /// in which case the Release fallback below is correct.
  private func provisionedApnsEnvironment() -> String? {
    guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
          let data = try? Data(contentsOf: url) else {
      return nil
    }

    let plistStartMarker = Data("<?xml".utf8)
    let plistEndMarker = Data("</plist>".utf8)
    guard let start = data.range(of: plistStartMarker)?.lowerBound,
          let endRange = data.range(
            of: plistEndMarker,
            options: [],
            in: start..<data.endIndex
          ) else {
      return nil
    }

    let plistData = data.subdata(in: start..<endRange.upperBound)
    guard let root = try? PropertyListSerialization.propertyList(
      from: plistData,
      options: [],
      format: nil
    ) as? [String: Any],
          let entitlements = root["Entitlements"] as? [String: Any] else {
      return nil
    }
    return normalizedApnsEnvironment(entitlements["aps-environment"])
  }

  private func signedApnsEnvironment() -> String {
    if let environment = provisionedApnsEnvironment() {
      return environment
    }
#if DEBUG
    return "sandbox"
#else
    return "production"
#endif
  }

  public func definition() -> ModuleDefinition {
    Name("InteliAdsNativeSync")

    AsyncFunction("getApnsEnvironmentAsync") { () -> String in
      self.signedApnsEnvironment()
    }

    // WKWebView's native cookie store is the only reliable source for
    // HttpOnly Amazon session cookies. Page JavaScript cannot read them.
    AsyncFunction("getCookieHeaderAsync") { (url: String) async -> String in
      await self.cookieHeader(for: url)
    }

    AsyncFunction("getStoreProductsAsync") { () async throws -> [[String: Any]] in
      guard #available(iOS 15.0, *) else { return [] }
      return try await InteliAdsStoreKit.products()
    }

    AsyncFunction("purchaseStoreProductAsync") { (productId: String, appAccountToken: String) async throws -> [String: Any] in
      guard #available(iOS 15.0, *) else { throw StoreKitBridgeError.productUnavailable }
      return try await InteliAdsStoreKit.purchase(productId: productId, appAccountToken: appAccountToken)
    }

    AsyncFunction("restoreStorePurchasesAsync") { () async throws -> [[String: Any]] in
      guard #available(iOS 15.0, *) else { return [] }
      return try await InteliAdsStoreKit.restore()
    }

    AsyncFunction("getStoreEntitlementsAsync") { () async -> [[String: Any]] in
      guard #available(iOS 15.0, *) else { return [] }
      return await InteliAdsStoreKit.currentEntitlements()
    }

    AsyncFunction("finishStoreTransactionAsync") { (transactionId: String) async throws -> Bool in
      guard #available(iOS 15.0, *) else { return false }
      return try await InteliAdsStoreKit.finish(transactionId: transactionId)
    }

    AsyncFunction("showManageStoreSubscriptionsAsync") { () async throws -> Bool in
      guard #available(iOS 15.0, *) else { return false }
      return try await InteliAdsStoreKit.showManageSubscriptions()
    }

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
