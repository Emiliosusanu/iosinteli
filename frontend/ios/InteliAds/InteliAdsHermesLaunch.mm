#import "InteliAdsHermesLaunch.h"

#include <jsinspector-modern/InspectorFlags.h>
#include <react/featureflags/ReactNativeFeatureFlags.h>
#include <react/featureflags/ReactNativeFeatureFlagsOverridesOSSStable.h>
#include <memory>

namespace {

class InteliAdsFeatureFlags final
    : public facebook::react::ReactNativeFeatureFlagsOverridesOSSStable {
 public:
  bool fuseboxEnabledRelease() override {
    return true;
  }
};

} // namespace

void InteliAdsDisableLegacyHermesDebugger(void) {
  facebook::react::ReactNativeFeatureFlags::dangerouslyForceOverride(
      std::make_unique<InteliAdsFeatureFlags>());
  facebook::react::jsinspector_modern::InspectorFlags::getInstance()
      .dangerouslyResetFlags();
}
