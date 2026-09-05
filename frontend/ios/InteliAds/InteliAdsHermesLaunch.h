#pragma once

#ifdef __cplusplus
extern "C" {
#endif

/// Skip the legacy Hermes chrome debugger. DVT attach on iOS 26 calls
/// HermesRuntimeImpl::debugJavaScript with a null inspector and SIGSEGVs.
void InteliAdsDisableLegacyHermesDebugger(void);

#ifdef __cplusplus
}
#endif
