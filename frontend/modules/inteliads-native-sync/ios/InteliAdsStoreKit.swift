import ExpoModulesCore
import Foundation
import StoreKit
import UIKit

@available(iOS 15.0, *)
enum InteliAdsStoreKit {
  static let productIds = [
    "io.inteliads.app.starter.month",
    "io.inteliads.app.starter.year",
    "io.inteliads.app.pro.month",
    "io.inteliads.app.pro.year",
    "io.inteliads.app.publisher.month",
    "io.inteliads.app.publisher.year",
  ]

  static func products() async throws -> [[String: Any]] {
    let products = try await Product.products(for: productIds)
    return products
      .sorted { lhs, rhs in
        guard let li = productIds.firstIndex(of: lhs.id),
              let ri = productIds.firstIndex(of: rhs.id) else { return lhs.id < rhs.id }
        return li < ri
      }
      .map { product in
        var row: [String: Any] = [
          "id": product.id,
          "displayName": product.displayName,
          "description": product.description,
          "displayPrice": product.displayPrice,
          "price": NSDecimalNumber(decimal: product.price).doubleValue,
        ]
        if let period = product.subscription?.subscriptionPeriod {
          row["periodUnit"] = period.unit.storeKitName
          row["periodValue"] = period.value
        }
        if let intro = product.subscription?.introductoryOffer {
          row["introDisplayPrice"] = intro.displayPrice
          row["introPeriods"] = intro.periodCount
        }
        return row
      }
  }

  static func purchase(productId: String, appAccountToken: String) async throws -> [String: Any] {
    guard productIds.contains(productId) else {
      throw StoreKitBridgeError.invalidProduct
    }
    guard let token = UUID(uuidString: appAccountToken) else {
      throw StoreKitBridgeError.invalidAccountToken
    }
    guard let product = try await Product.products(for: [productId]).first else {
      throw StoreKitBridgeError.productUnavailable
    }

    let result = try await product.purchase(options: [.appAccountToken(token)])
    switch result {
    case .success(let verification):
      switch verification {
      case .verified(let transaction):
        // The caller finishes only after the InteliAds server verifies the
        // signed JWS and persists the entitlement. A crash or network error
        // therefore leaves the transaction available for a safe retry.
        return transactionPayload(verification, transaction: transaction)
      case .unverified:
        throw StoreKitBridgeError.unverifiedTransaction
      }
    case .pending:
      return ["status": "pending", "productId": productId]
    case .userCancelled:
      return ["status": "cancelled", "productId": productId]
    @unknown default:
      throw StoreKitBridgeError.unknownResult
    }
  }

  static func currentEntitlements() async -> [[String: Any]] {
    var result: [[String: Any]] = []
    for await verification in Transaction.currentEntitlements {
      guard case .verified(let transaction) = verification,
            productIds.contains(transaction.productID) else { continue }
      result.append(transactionPayload(verification, transaction: transaction))
    }
    return result
  }

  static func restore() async throws -> [[String: Any]] {
    try await AppStore.sync()
    return await currentEntitlements()
  }

  static func finish(transactionId: String) async throws -> Bool {
    for await verification in Transaction.unfinished {
      guard case .verified(let transaction) = verification else { continue }
      if String(transaction.id) == transactionId {
        await transaction.finish()
        return true
      }
    }
    // A previously finished transaction is already complete; make the
    // operation idempotent so a response retry never becomes a user error.
    return true
  }

  @MainActor
  static func showManageSubscriptions() async throws -> Bool {
    guard let scene = UIApplication.shared.connectedScenes
      .compactMap({ $0 as? UIWindowScene })
      .first(where: { $0.activationState == .foregroundActive }) else {
      throw StoreKitBridgeError.windowUnavailable
    }
    try await AppStore.showManageSubscriptions(in: scene)
    return true
  }

  private static func transactionPayload(
    _ verification: VerificationResult<Transaction>,
    transaction: Transaction
  ) -> [String: Any] {
    var payload: [String: Any] = [
      "status": "verified",
      "productId": transaction.productID,
      "transactionId": String(transaction.id),
      "originalTransactionId": String(transaction.originalID),
      "purchaseDateMs": Int(transaction.purchaseDate.timeIntervalSince1970 * 1000),
      "signedTransaction": verification.jwsRepresentation,
    ]
    if let expires = transaction.expirationDate {
      payload["expiresDateMs"] = Int(expires.timeIntervalSince1970 * 1000)
    }
    if let revoked = transaction.revocationDate {
      payload["revocationDateMs"] = Int(revoked.timeIntervalSince1970 * 1000)
    }
    return payload
  }
}

@available(iOS 15.0, *)
private extension Product.SubscriptionPeriod.Unit {
  var storeKitName: String {
    switch self {
    case .day: return "day"
    case .week: return "week"
    case .month: return "month"
    case .year: return "year"
    @unknown default: return "unknown"
    }
  }
}

enum StoreKitBridgeError: LocalizedError {
  case invalidProduct
  case invalidAccountToken
  case productUnavailable
  case unverifiedTransaction
  case unknownResult
  case windowUnavailable

  var errorDescription: String? {
    switch self {
    case .invalidProduct: return "This subscription is not supported."
    case .invalidAccountToken: return "Sign in again before purchasing."
    case .productUnavailable: return "This subscription is not available from the App Store."
    case .unverifiedTransaction: return "The App Store could not verify this purchase."
    case .unknownResult: return "The App Store returned an unknown purchase result."
    case .windowUnavailable: return "The App Store subscription screen is temporarily unavailable."
    }
  }
}
