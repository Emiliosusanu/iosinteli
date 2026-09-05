import ExpoModulesCore
import UIKit

public class InteliAdsNativeSyncAppDelegate: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    InteliAdsBackgroundRefreshManager.shared.register()
    InteliAdsBackgroundRefreshManager.shared.scheduleIfNeeded(force: true)
    return true
  }

  public func applicationDidBecomeActive(_ application: UIApplication) {
    InteliAdsBackgroundRefreshManager.shared.scheduleIfNeeded(force: false)
  }

  public func applicationDidEnterBackground(_ application: UIApplication) {
    InteliAdsBackgroundRefreshManager.shared.scheduleIfNeeded(force: true)
  }
}
