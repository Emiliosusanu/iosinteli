import Foundation
import BackgroundTasks
import ExpoModulesCore
import UIKit

/// Slim Royaltix-parity metronome: BGAppRefresh + BGProcessing every ~15 minutes.
/// On delivery, runs Expo TaskManager background consumers (KDP helper + financial refresh).
public final class InteliAdsBackgroundRefreshManager {
  public static let shared = InteliAdsBackgroundRefreshManager()

  public static let refreshTaskId = "io.inteliads.app.refresh"
  public static let processingTaskId = "io.inteliads.app.processing"

  private static let enabledKey = "inteliads_bg_metronome_enabled"
  private static let lastSuccessTsKey = "inteliads_bg_last_success_ts"
  private static let lastRunTsKey = "inteliads_bg_last_run_ts"
  private static let lastErrorKey = "inteliads_bg_last_error"
  private static let lastScheduledTsKey = "inteliads_bg_last_scheduled_ts"

  /// Match Royaltix / App Store build 61 floor.
  private static let metronomeSeconds: TimeInterval = 15 * 60
  /// When last success is older than 15m, ask sooner (Royaltix catch-up).
  private static let catchUpDelaySeconds: TimeInterval = 60

  private var didRegister = false
  private let scheduleLock = NSLock()

  private init() {}

  private var defaults: UserDefaults { .standard }

  public var isEnabled: Bool {
    get { defaults.object(forKey: Self.enabledKey) as? Bool ?? true }
    set { defaults.set(newValue, forKey: Self.enabledKey) }
  }

  public func register() {
    guard !didRegister else { return }
    didRegister = true

#if targetEnvironment(simulator)
    return
#else
    BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.refreshTaskId, using: nil) { [weak self] task in
      guard let refresh = task as? BGAppRefreshTask else {
        task.setTaskCompleted(success: false)
        return
      }
      self?.handleRefresh(refresh)
    }

    BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.processingTaskId, using: nil) { [weak self] task in
      guard let processing = task as? BGProcessingTask else {
        task.setTaskCompleted(success: false)
        return
      }
      self?.handleProcessing(processing)
    }
#endif
  }

  public func scheduleIfNeeded(force: Bool = false) {
#if targetEnvironment(simulator)
    return
#else
    guard isEnabled else {
      BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.refreshTaskId)
      BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.processingTaskId)
      return
    }

    scheduleLock.lock()
    defer { scheduleLock.unlock() }

    let delay = nextDelaySeconds()
    let earliest = Date().addingTimeInterval(delay)

    if !force {
      let lastScheduled = defaults.double(forKey: Self.lastScheduledTsKey)
      if lastScheduled > 0, Date().timeIntervalSince1970 - lastScheduled < 5 {
        return
      }
    }

    BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.refreshTaskId)
    BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.processingTaskId)

    let refresh = BGAppRefreshTaskRequest(identifier: Self.refreshTaskId)
    refresh.earliestBeginDate = earliest

    let processing = BGProcessingTaskRequest(identifier: Self.processingTaskId)
    processing.earliestBeginDate = earliest
    processing.requiresNetworkConnectivity = true
    processing.requiresExternalPower = false

    do {
      try BGTaskScheduler.shared.submit(refresh)
      try BGTaskScheduler.shared.submit(processing)
      defaults.set(Date().timeIntervalSince1970, forKey: Self.lastScheduledTsKey)
    } catch {
      defaults.set(String(describing: error), forKey: Self.lastErrorKey)
    }
#endif
  }

  public func cancel() {
#if !targetEnvironment(simulator)
    BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.refreshTaskId)
    BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.processingTaskId)
#endif
  }

  public func statusDictionary() -> [String: Any] {
    let lastSuccess = defaults.double(forKey: Self.lastSuccessTsKey)
    let lastRun = defaults.double(forKey: Self.lastRunTsKey)
    return [
      "enabled": isEnabled,
      "refreshTaskId": Self.refreshTaskId,
      "processingTaskId": Self.processingTaskId,
      "metronomeSeconds": Self.metronomeSeconds,
      "lastSuccessAtMs": lastSuccess > 0 ? Int(lastSuccess * 1000) : 0,
      "lastRunAtMs": lastRun > 0 ? Int(lastRun * 1000) : 0,
      "lastError": defaults.string(forKey: Self.lastErrorKey) ?? "",
      "nextDelaySeconds": nextDelaySeconds(),
      "backgroundRefreshStatus": UIApplication.shared.backgroundRefreshStatus.rawValue,
    ]
  }

  private func nextDelaySeconds() -> TimeInterval {
    let lastSuccess = defaults.double(forKey: Self.lastSuccessTsKey)
    guard lastSuccess > 0 else { return Self.metronomeSeconds }
    let age = Date().timeIntervalSince1970 - lastSuccess
    if age >= Self.metronomeSeconds {
      return Self.catchUpDelaySeconds
    }
    return max(Self.catchUpDelaySeconds, Self.metronomeSeconds - age)
  }

  /// Queued for JS before EXTaskService runs — refresh=today+yesterday, processing=2am backfill drain.
  private static let pendingWakeKindKey = "inteliads_native_pending_wake_kind"

  public static func setPendingWakeKind(_ kind: String) {
    UserDefaults.standard.set(kind, forKey: pendingWakeKindKey)
  }

  /// JS consumes once per wake so Expo-only deliveries fall through to smart mode.
  public static func consumePendingWakeKind() -> String? {
    let defaults = UserDefaults.standard
    let kind = defaults.string(forKey: pendingWakeKindKey)
    defaults.removeObject(forKey: pendingWakeKindKey)
    guard let kind, kind == "recent" || kind == "processing" else { return nil }
    return kind
  }

  private func handleRefresh(_ task: BGAppRefreshTask) {
    let gate = CompletionGate()
    task.expirationHandler = {
      if gate.markExpired() {
        task.setTaskCompleted(success: false)
      }
      InteliAdsWidgetSnapshotStore.updateSync(
        status: "Paused",
        detail: "iOS ended the refresh slice",
        isActive: false
      )
#if canImport(WidgetKit)
      InteliAdsWidgetSnapshotStore.reloadTimelines(force: true)
#endif
      self.scheduleIfNeeded(force: true)
    }

    InteliAdsWidgetSnapshotStore.updateSync(
      status: "Syncing",
      detail: "BGAppRefresh · today + yesterday",
      progress: 0.15,
      isActive: true
    )
#if canImport(WidgetKit)
    InteliAdsWidgetSnapshotStore.reloadTimelines(force: true)
#endif

    // Short wake: steady today+yesterday (+ leftover slice). Nightly opens after 2am but full drain waits for processing.
    Self.setPendingWakeKind("recent")
    runExpoBackgroundTasks { [weak self] ok in
      guard let self else { return }
      self.recordRun(success: ok)
      InteliAdsWidgetSnapshotStore.updateSync(
        status: ok ? "Updated" : "Retrying",
        detail: ok ? "Recent KDP pass finished" : "Background pass incomplete",
        progress: ok ? 1 : nil,
        isActive: false,
        completedAt: ok ? Date() : nil
      )
#if canImport(WidgetKit)
      InteliAdsWidgetSnapshotStore.reloadTimelines(force: true)
#endif
      self.scheduleIfNeeded(force: true)
      if gate.markCompleted() {
        task.setTaskCompleted(success: ok)
      }
    }
  }

  private func handleProcessing(_ task: BGProcessingTask) {
    let gate = CompletionGate()
    task.expirationHandler = {
      if gate.markExpired() {
        task.setTaskCompleted(success: false)
      }
      InteliAdsWidgetSnapshotStore.updateSync(
        status: "Paused",
        detail: "iOS ended the processing slice",
        isActive: false
      )
#if canImport(WidgetKit)
      InteliAdsWidgetSnapshotStore.reloadTimelines(force: true)
#endif
      self.scheduleIfNeeded(force: true)
    }

    InteliAdsWidgetSnapshotStore.updateSync(
      status: "Syncing",
      detail: "BGProcessing · backfill drain",
      progress: 0.2,
      isActive: true
    )
#if canImport(WidgetKit)
    InteliAdsWidgetSnapshotStore.reloadTimelines(force: true)
#endif

    // Longer wake: onboarding chunks + up to 30 deferred (2am last-30 nightly).
    Self.setPendingWakeKind("processing")
    runExpoBackgroundTasks { [weak self] ok in
      guard let self else { return }
      self.recordRun(success: ok)
      InteliAdsWidgetSnapshotStore.updateSync(
        status: ok ? "Updated" : "Retrying",
        detail: ok ? "Processing pass finished" : "Processing pass incomplete",
        progress: ok ? 1 : nil,
        isActive: false,
        completedAt: ok ? Date() : nil
      )
#if canImport(WidgetKit)
      InteliAdsWidgetSnapshotStore.reloadTimelines(force: true)
#endif
      self.scheduleIfNeeded(force: true)
      if gate.markCompleted() {
        task.setTaskCompleted(success: ok)
      }
    }
  }

  private func recordRun(success: Bool) {
    let now = Date().timeIntervalSince1970
    defaults.set(now, forKey: Self.lastRunTsKey)
    if success {
      defaults.set(now, forKey: Self.lastSuccessTsKey)
      defaults.removeObject(forKey: Self.lastErrorKey)
    }
  }

  /// Same path Expo's BGProcessing worker uses — wakes TaskManager-defined JS tasks.
  private func runExpoBackgroundTasks(completion: @escaping (Bool) -> Void) {
    DispatchQueue.main.async {
      guard let taskService = ModuleRegistryProvider.singletonModules()
        .first(where: { $0 is EXTaskServiceInterface }) as? EXTaskServiceInterface
      else {
        completion(false)
        return
      }
      taskService.runTasks(with: EXTaskLaunchReasonBackgroundTask, userInfo: nil) { result in
        let ok: Bool
        if let fetch = result as? UIBackgroundFetchResult {
          ok = fetch != .failed
        } else if let raw = result as? UInt {
          ok = raw != UIBackgroundFetchResult.failed.rawValue
        } else {
          ok = true
        }
        completion(ok)
      }
    }
  }
}

private final class CompletionGate {
  private let lock = NSLock()
  private var finished = false
  private var expired = false

  var isExpired: Bool {
    lock.lock(); defer { lock.unlock() }
    return expired
  }

  func markExpired() -> Bool {
    lock.lock(); defer { lock.unlock() }
    guard !finished else { return false }
    expired = true
    finished = true
    return true
  }

  func markCompleted() -> Bool {
    lock.lock(); defer { lock.unlock() }
    guard !finished else { return false }
    finished = true
    return true
  }
}
