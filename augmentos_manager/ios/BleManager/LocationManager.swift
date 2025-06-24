//
//  LocationManager.swift
//  AugmentOS_Manager
//
//  Created by Matthew Fosse on 3/16/25.
//

import Foundation
import CoreLocation

class LocationManager: NSObject, CLLocationManagerDelegate {
  private let locationManager = CLLocationManager()
  private var locationChangedCallback: (() -> Void)?
  private var currentLocation: CLLocation?
  private var locationPollingTimer: Timer? // [NEW] Timer for low-power polling
  
  override init() {
    super.init()
    // delay setup until after login:
    // setup()
  }
  
  public func setup() {
    locationManager.delegate = self
    locationManager.desiredAccuracy = kCLLocationAccuracyBest
    locationManager.distanceFilter = 2 // Update when user moves 2 meters
    locationManager.allowsBackgroundLocationUpdates = false
    locationManager.pausesLocationUpdatesAutomatically = true
    
    // No longer requesting authorization here - permissions are handled by React Native
    
    // Start location updates (will only work if permission is already granted)
    locationManager.startUpdatingLocation()
  }
  
  public func setLocationChangedCallback(_ callback: @escaping () -> Void) {
    self.locationChangedCallback = callback
  }

  // [UPDATED] Full implementation for tiered streaming
  public func setLocationTier(_ tier: String) {
    // Always stop any previous work before starting a new mode
    locationManager.stopUpdatingLocation()
    locationPollingTimer?.invalidate()
    locationPollingTimer = nil

    print("LocationManager: Setting location tier to \(tier)")

    switch tier {
    case "realtime":
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.pausesLocationUpdatesAutomatically = false
        locationManager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        locationManager.distanceFilter = kCLDistanceFilterNone
        locationManager.startUpdatingLocation()

    case "high":
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.pausesLocationUpdatesAutomatically = false
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = 2
        locationManager.startUpdatingLocation()

    case "tenMeters":
        locationManager.allowsBackgroundLocationUpdates = false
        locationManager.pausesLocationUpdatesAutomatically = true
        locationManager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        locationManager.distanceFilter = 10
        locationManager.startUpdatingLocation()

    case "hundredMeters":
        locationManager.allowsBackgroundLocationUpdates = false
        locationManager.pausesLocationUpdatesAutomatically = true
        locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        locationManager.distanceFilter = 100
        locationManager.startUpdatingLocation()

    case "kilometer":
        locationManager.allowsBackgroundLocationUpdates = false
        locationManager.pausesLocationUpdatesAutomatically = true
        // Use timer-based polling for low-power, infrequent updates
        locationPollingTimer = Timer.scheduledTimer(withTimeInterval: 300.0, repeats: true) { [weak self] _ in
            self?.locationManager.requestLocation()
        }
    
    case "threeKilometers", "reduced":
        locationManager.allowsBackgroundLocationUpdates = false
        locationManager.pausesLocationUpdatesAutomatically = true
        // Use timer-based polling for lowest-power, very infrequent updates
        locationPollingTimer = Timer.scheduledTimer(withTimeInterval: 900.0, repeats: true) { [weak self] _ in
            self?.locationManager.requestLocation()
        }

    default:
        // Turn everything off if tier is unknown or "off"
        locationManager.allowsBackgroundLocationUpdates = false
        locationManager.pausesLocationUpdatesAutomatically = true
    }
  }
  
  // [UPDATED] Full implementation for on-demand polling
  public func requestSingleUpdate(accuracy: String) {
    print("LocationManager: Requesting single update with accuracy \(accuracy)")
    
    // Set the desired accuracy for this specific one-time request
    switch accuracy {
      case "realtime":
        locationManager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
      case "high":
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
      case "tenMeters":
        locationManager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
      case "hundredMeters":
        locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
      case "kilometer":
        locationManager.desiredAccuracy = kCLLocationAccuracyKilometer
      case "threeKilometers":
        locationManager.desiredAccuracy = kCLLocationAccuracyThreeKilometers
      default: // reduced
        locationManager.desiredAccuracy = kCLLocationAccuracyReduced
    }
    
    // This is Apple's built-in method for a single, power-efficient location fix.
    // It turns the GPS on, gets one location, and turns it off.
    locationManager.requestLocation()
  }
  
  // MARK: - CLLocationManagerDelegate Methods
  
  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let location = locations.last else { return }
    
    // Only process significant changes (>10m or first location)
    if currentLocation == nil || location.distance(from: currentLocation!) > locationManager.distanceFilter {
      currentLocation = location

      print("LocationManager: Location updated to \(location.coordinate.latitude), \(location.coordinate.longitude)")
      
      // Notify via callback
      locationChangedCallback?()
    }
  }
  
  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    print("LocationManager: Failed to get location. Error: \(error.localizedDescription)")
  }
  
  func locationManager(_ manager: CLLocationManager, didChangeAuthorization status: CLAuthorizationStatus) {
    switch status {
    case .authorizedWhenInUse, .authorizedAlways:
      locationManager.startUpdatingLocation()
    case .denied, .restricted:
      print("LocationManager: Location access denied or restricted")
    case .notDetermined:
      print("LocationManager: Location permission not determined yet")
    @unknown default:
      print("LocationManager: Unknown authorization status")
    }
  }
  
  // MARK: - Location Getters
  
  func getCurrentLocation() -> (latitude: Double, longitude: Double)? {
    guard let location = currentLocation else { return nil }
    return (latitude: location.coordinate.latitude, longitude: location.coordinate.longitude)
  }
  
  func getLastKnownLocation() -> (latitude: Double, longitude: Double)? {
    return getCurrentLocation()
  }
}
