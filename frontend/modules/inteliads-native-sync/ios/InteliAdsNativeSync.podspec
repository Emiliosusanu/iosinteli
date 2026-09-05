require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'InteliAdsNativeSync'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = 'InteliAds'
  s.homepage       = 'https://inteliads.app'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: 'https://github.com/placeholder/inteliads-native-sync.git' }
  s.static_framework = true
  s.source_files = '**/*.{h,m,mm,swift}'
  s.frameworks = 'BackgroundTasks', 'WidgetKit'
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
