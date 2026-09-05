#!/usr/bin/env python3
"""Add InteliAdsSyncWidget extension target to the Xcode project if missing."""
from __future__ import annotations

import hashlib
import pathlib
import re
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
PBX = ROOT / "ios" / "InteliAds.xcodeproj" / "project.pbxproj"
WIDGET_DIR = "InteliAdsSyncWidget"
SHARED = "SyncActivityShared"


def uid(name: str) -> str:
    digest = hashlib.md5(f"inteliads-widget-{name}".encode()).hexdigest().upper()
    return digest[:24]


def main() -> None:
    text = PBX.read_text()
    if "InteliAdsSyncWidget" in text and "io.inteliads.app.syncwidget" in text:
        print("widget target already present")
        return

    target = uid("target")
    sources_phase = uid("sources")
    resources_phase = uid("resources")
    frameworks_phase = uid("frameworks")
    product_ref = uid("product")
    config_list = uid("configs")
    debug_cfg = uid("debug")
    release_cfg = uid("release")
    embed_phase = uid("embed")

    files = [
        ("InteliAdsSyncWidgetBundle.swift", "InteliAdsSyncWidgetBundle.swift", WIDGET_DIR),
        ("InteliAdsSyncStatusWidget.swift", "InteliAdsSyncStatusWidget.swift", WIDGET_DIR),
        ("InteliAdsWidgetSnapshot.swift", "InteliAdsWidgetSnapshot.swift", SHARED),
        ("Info.plist", "Info.plist", WIDGET_DIR),
        ("InteliAdsSyncWidget.entitlements", "InteliAdsSyncWidget.entitlements", WIDGET_DIR),
    ]
    file_refs = {name: uid(f"ref-{name}") for name, _, _ in files}
    build_files = {
        name: uid(f"build-{name}")
        for name, _, _ in files
        if name.endswith(".swift")
    }

    # PBXBuildFile section
    build_file_block = "\n".join(
        f"\t\t{build_files[name]} /* {name} in Sources */ = {{isa = PBXBuildFile; fileRef = {file_refs[name]} /* {name} */; }};"
        for name in build_files
    )
    embed_build = uid("embed-build")
    build_file_block += (
        f"\n\t\t{embed_build} /* InteliAdsSyncWidget.appex in Embed Foundation Extensions */ = "
        f"{{isa = PBXBuildFile; fileRef = {product_ref} /* InteliAdsSyncWidget.appex */; "
        f"settings = {{ATTRIBUTES = (RemoveHeadersOnCopy, ); }}; }};"
    )

    text = text.replace(
        "/* Begin PBXBuildFile section */\n",
        "/* Begin PBXBuildFile section */\n" + build_file_block + "\n",
        1,
    )

    # PBXFileReference — paths are relative to their parent group
    file_ref_lines = []
    for name, rel, _ in files:
        if name.endswith(".swift"):
            ftype = "sourcecode.swift"
        elif name.endswith(".entitlements"):
            ftype = "text.plist.entitlements"
        else:
            ftype = "text.plist.xml"
        file_ref_lines.append(
            f'\t\t{file_refs[name]} /* {name} */ = {{isa = PBXFileReference; lastKnownFileType = {ftype}; path = "{rel}"; sourceTree = "<group>"; }};'
        )
    file_ref_block = "\n".join(file_ref_lines)
    file_ref_block += (
        f"\n\t\t{product_ref} /* InteliAdsSyncWidget.appex */ = {{isa = PBXFileReference; "
        f"explicitFileType = \"wrapper.app-extension\"; includeInIndex = 0; "
        f"path = InteliAdsSyncWidget.appex; sourceTree = BUILT_PRODUCTS_DIR; }};"
    )
    text = text.replace(
        "/* Begin PBXFileReference section */\n",
        "/* Begin PBXFileReference section */\n" + file_ref_block + "\n",
        1,
    )

    # Groups
    widget_group = uid("widget-group")
    shared_group = uid("shared-group")
    group_block = f"""
\t\t{widget_group} /* InteliAdsSyncWidget */ = {{
\t\t\tisa = PBXGroup;
\t\t\tchildren = (
\t\t\t\t{file_refs['InteliAdsSyncWidgetBundle.swift']} /* InteliAdsSyncWidgetBundle.swift */,
\t\t\t\t{file_refs['InteliAdsSyncStatusWidget.swift']} /* InteliAdsSyncStatusWidget.swift */,
\t\t\t\t{file_refs['Info.plist']} /* Info.plist */,
\t\t\t\t{file_refs['InteliAdsSyncWidget.entitlements']} /* InteliAdsSyncWidget.entitlements */,
\t\t\t);
\t\t\tpath = InteliAdsSyncWidget;
\t\t\tsourceTree = "<group>";
\t\t}};
\t\t{shared_group} /* SyncActivityShared */ = {{
\t\t\tisa = PBXGroup;
\t\t\tchildren = (
\t\t\t\t{file_refs['InteliAdsWidgetSnapshot.swift']} /* InteliAdsWidgetSnapshot.swift */,
\t\t\t);
\t\t\tpath = SyncActivityShared;
\t\t\tsourceTree = "<group>";
\t\t}};
"""
    text = text.replace(
        "/* Begin PBXGroup section */\n",
        "/* Begin PBXGroup section */\n" + group_block,
        1,
    )

    # Insert groups into main children — find first PBXGroup with path = . or main group
    # Add to Products group and root children
    products_match = re.search(
        r"(/\* Products \*/ = \{\s*isa = PBXGroup;\s*children = \()([^\)]*)(\);)",
        text,
        re.S,
    )
    if products_match:
        children = products_match.group(2)
        if product_ref not in children:
            text = (
                text[: products_match.start(2)]
                + children
                + f"\n\t\t\t\t{product_ref} /* InteliAdsSyncWidget.appex */,"
                + text[products_match.end(2) :]
            )

    # Add widget/shared groups near InteliAds group reference in root
    root_insert = f"\n\t\t\t\t{widget_group} /* InteliAdsSyncWidget */,\n\t\t\t\t{shared_group} /* SyncActivityShared */,"
    # Prefer inserting after InteliAds group line
    if "/* InteliAds */," in text and f"{widget_group} /* InteliAdsSyncWidget */" not in text:
        text = text.replace("/* InteliAds */,", "/* InteliAds */," + root_insert, 1)

    # Sources / Frameworks / Resources build phases
    sources_block = f"""
\t\t{sources_phase} /* Sources */ = {{
\t\t\tisa = PBXSourcesBuildPhase;
\t\t\tbuildActionMask = 2147483647;
\t\t\tfiles = (
\t\t\t\t{build_files['InteliAdsSyncWidgetBundle.swift']} /* InteliAdsSyncWidgetBundle.swift in Sources */,
\t\t\t\t{build_files['InteliAdsSyncStatusWidget.swift']} /* InteliAdsSyncStatusWidget.swift in Sources */,
\t\t\t\t{build_files['InteliAdsWidgetSnapshot.swift']} /* InteliAdsWidgetSnapshot.swift in Sources */,
\t\t\t);
\t\t\trunOnlyForDeploymentPostprocessing = 0;
\t\t}};
"""
    frameworks_block = f"""
\t\t{frameworks_phase} /* Frameworks */ = {{
\t\t\tisa = PBXFrameworksBuildPhase;
\t\t\tbuildActionMask = 2147483647;
\t\t\tfiles = (
\t\t\t);
\t\t\trunOnlyForDeploymentPostprocessing = 0;
\t\t}};
"""
    resources_block = f"""
\t\t{resources_phase} /* Resources */ = {{
\t\t\tisa = PBXResourcesBuildPhase;
\t\t\tbuildActionMask = 2147483647;
\t\t\tfiles = (
\t\t\t);
\t\t\trunOnlyForDeploymentPostprocessing = 0;
\t\t}};
"""
    text = text.replace(
        "/* Begin PBXSourcesBuildPhase section */\n",
        "/* Begin PBXSourcesBuildPhase section */\n" + sources_block,
        1,
    )
    if "/* Begin PBXFrameworksBuildPhase section */" in text:
        text = text.replace(
            "/* Begin PBXFrameworksBuildPhase section */\n",
            "/* Begin PBXFrameworksBuildPhase section */\n" + frameworks_block,
            1,
        )
    if "/* Begin PBXResourcesBuildPhase section */" in text:
        text = text.replace(
            "/* Begin PBXResourcesBuildPhase section */\n",
            "/* Begin PBXResourcesBuildPhase section */\n" + resources_block,
            1,
        )

    # Copy Files embed phase on app target
    embed_block = f"""
\t\t{embed_phase} /* Embed Foundation Extensions */ = {{
\t\t\tisa = PBXCopyFilesBuildPhase;
\t\t\tbuildActionMask = 2147483647;
\t\t\tdstPath = "";
\t\t\tdstSubfolderSpec = 13;
\t\t\tfiles = (
\t\t\t\t{embed_build} /* InteliAdsSyncWidget.appex in Embed Foundation Extensions */,
\t\t\t);
\t\t\tname = "Embed Foundation Extensions";
\t\t\trunOnlyForDeploymentPostprocessing = 0;
\t\t}};
"""
    if "/* Begin PBXCopyFilesBuildPhase section */" in text:
        text = text.replace(
            "/* Begin PBXCopyFilesBuildPhase section */\n",
            "/* Begin PBXCopyFilesBuildPhase section */\n" + embed_block,
            1,
        )
    else:
        text = text.replace(
            "/* Begin PBXSourcesBuildPhase section */\n",
            "/* Begin PBXCopyFilesBuildPhase section */\n"
            + embed_block
            + "/* End PBXCopyFilesBuildPhase section */\n\n/* Begin PBXSourcesBuildPhase section */\n",
            1,
        )

    # Native target
    native_target = f"""
\t\t{target} /* InteliAdsSyncWidget */ = {{
\t\t\tisa = PBXNativeTarget;
\t\t\tbuildConfigurationList = {config_list} /* Build configuration list for PBXNativeTarget "InteliAdsSyncWidget" */;
\t\t\tbuildPhases = (
\t\t\t\t{sources_phase} /* Sources */,
\t\t\t\t{frameworks_phase} /* Frameworks */,
\t\t\t\t{resources_phase} /* Resources */,
\t\t\t);
\t\t\tbuildRules = (
\t\t\t);
\t\t\tdependencies = (
\t\t\t);
\t\t\tname = InteliAdsSyncWidget;
\t\t\tproductName = InteliAdsSyncWidget;
\t\t\tproductReference = {product_ref} /* InteliAdsSyncWidget.appex */;
\t\t\tproductType = "com.apple.product-type.app-extension";
\t\t}};
"""
    text = text.replace(
        "/* Begin PBXNativeTarget section */\n",
        "/* Begin PBXNativeTarget section */\n" + native_target,
        1,
    )

    # Add target dependency + embed phase to InteliAds app target
    # Find InteliAds native target buildPhases
    app_target_match = re.search(
        r"(/\* InteliAds \*/ = \{\s*isa = PBXNativeTarget;.*?buildPhases = \()(.*?)(\);.*?name = InteliAds;)",
        text,
        re.S,
    )
    if app_target_match and embed_phase not in app_target_match.group(2):
        text = (
            text[: app_target_match.start(2)]
            + app_target_match.group(2)
            + f"\n\t\t\t\t{embed_phase} /* Embed Foundation Extensions */,"
            + text[app_target_match.end(2) :]
        )

    # Target dependency
    dep_id = uid("dependency")
    proxy_id = uid("proxy")
    dep_block = f"""
\t\t{dep_id} /* PBXTargetDependency */ = {{
\t\t\tisa = PBXTargetDependency;
\t\t\ttarget = {target} /* InteliAdsSyncWidget */;
\t\t\ttargetProxy = {proxy_id} /* PBXContainerItemProxy */;
\t\t}};
"""
    proxy_block = f"""
\t\t{proxy_id} /* PBXContainerItemProxy */ = {{
\t\t\tisa = PBXContainerItemProxy;
\t\t\tcontainerPortal = {container_portal(text)} /* Project object */;
\t\t\tproxyType = 1;
\t\t\tremoteGlobalIDString = {target};
\t\t\tremoteInfo = InteliAdsSyncWidget;
\t\t}};
"""
    if "/* Begin PBXTargetDependency section */" in text:
        text = text.replace(
            "/* Begin PBXTargetDependency section */\n",
            "/* Begin PBXTargetDependency section */\n" + dep_block,
            1,
        )
    else:
        text += "\n/* Begin PBXTargetDependency section */\n" + dep_block + "/* End PBXTargetDependency section */\n"

    if "/* Begin PBXContainerItemProxy section */" in text:
        text = text.replace(
            "/* Begin PBXContainerItemProxy section */\n",
            "/* Begin PBXContainerItemProxy section */\n" + proxy_block,
            1,
        )

    app_deps = re.search(
        r"(/\* InteliAds \*/ = \{\s*isa = PBXNativeTarget;.*?dependencies = \()(.*?)(\);)",
        text,
        re.S,
    )
    if app_deps and dep_id not in app_deps.group(2):
        text = (
            text[: app_deps.start(2)]
            + app_deps.group(2)
            + f"\n\t\t\t\t{dep_id} /* PBXTargetDependency */,"
            + text[app_deps.end(2) :]
        )

    # Build configurations
    cfg_block = f"""
\t\t{debug_cfg} /* Debug */ = {{
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {{
\t\t\t\tCODE_SIGN_ENTITLEMENTS = InteliAdsSyncWidget/InteliAdsSyncWidget.entitlements;
\t\t\t\tCODE_SIGN_STYLE = Automatic;
\t\t\t\tCURRENT_PROJECT_VERSION = 37;
\t\t\t\tGENERATE_INFOPLIST_FILE = NO;
\t\t\t\tINFOPLIST_FILE = InteliAdsSyncWidget/Info.plist;
\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = 16.0;
\t\t\t\tLD_RUNPATH_SEARCH_PATHS = (
\t\t\t\t\t"$(inherited)",
\t\t\t\t\t"@executable_path/Frameworks",
\t\t\t\t\t"@executable_path/../../Frameworks",
\t\t\t\t);
\t\t\t\tMARKETING_VERSION = 1.0.1;
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = io.inteliads.app.syncwidget;
\t\t\t\tPRODUCT_NAME = "$(TARGET_NAME)";
\t\t\t\tSKIP_INSTALL = YES;
\t\t\t\tSWIFT_VERSION = 5.0;
\t\t\t\tTARGETED_DEVICE_FAMILY = "1,2";
\t\t\t}};
\t\t\tname = Debug;
\t\t}};
\t\t{release_cfg} /* Release */ = {{
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {{
\t\t\t\tCODE_SIGN_ENTITLEMENTS = InteliAdsSyncWidget/InteliAdsSyncWidget.entitlements;
\t\t\t\tCODE_SIGN_STYLE = Automatic;
\t\t\t\tCURRENT_PROJECT_VERSION = 37;
\t\t\t\tGENERATE_INFOPLIST_FILE = NO;
\t\t\t\tINFOPLIST_FILE = InteliAdsSyncWidget/Info.plist;
\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = 16.0;
\t\t\t\tLD_RUNPATH_SEARCH_PATHS = (
\t\t\t\t\t"$(inherited)",
\t\t\t\t\t"@executable_path/Frameworks",
\t\t\t\t\t"@executable_path/../../Frameworks",
\t\t\t\t);
\t\t\t\tMARKETING_VERSION = 1.0.1;
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = io.inteliads.app.syncwidget;
\t\t\t\tPRODUCT_NAME = "$(TARGET_NAME)";
\t\t\t\tSKIP_INSTALL = YES;
\t\t\t\tSWIFT_VERSION = 5.0;
\t\t\t\tTARGETED_DEVICE_FAMILY = "1,2";
\t\t\t}};
\t\t\tname = Release;
\t\t}};
"""
    text = text.replace(
        "/* Begin XCBuildConfiguration section */\n",
        "/* Begin XCBuildConfiguration section */\n" + cfg_block,
        1,
    )

    cfg_list_block = f"""
\t\t{config_list} /* Build configuration list for PBXNativeTarget "InteliAdsSyncWidget" */ = {{
\t\t\tisa = XCConfigurationList;
\t\t\tbuildConfigurations = (
\t\t\t\t{debug_cfg} /* Debug */,
\t\t\t\t{release_cfg} /* Release */,
\t\t\t);
\t\t\tdefaultConfigurationIsVisible = 0;
\t\t\tdefaultConfigurationName = Release;
\t\t}};
"""
    text = text.replace(
        "/* Begin XCConfigurationList section */\n",
        "/* Begin XCConfigurationList section */\n" + cfg_list_block,
        1,
    )

    # Add to project targets list
    targets_match = re.search(
        r"(targets = \()([^\)]*InteliAds[^\)]*)(\);)",
        text,
        re.S,
    )
    if targets_match and target not in targets_match.group(2):
        text = (
            text[: targets_match.start(2)]
            + targets_match.group(2)
            + f"\n\t\t\t\t{target} /* InteliAdsSyncWidget */,"
            + text[targets_match.end(2) :]
        )

    PBX.write_text(text)
    print("added InteliAdsSyncWidget target")


def container_portal(text: str) -> str:
    m = re.search(r"([A-F0-9]{24}) /\* Project object \*/", text)
    if not m:
        raise SystemExit("could not find Project object id")
    return m.group(1)


if __name__ == "__main__":
    main()
