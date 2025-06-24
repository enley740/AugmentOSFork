import { User, UserI } from '../../models/user.model';
import { sessionService } from '../session/session.service';
import subscriptionService from '../session/subscription.service';
import { logger as rootLogger } from '../logging/pino-logger';
import WebSocket from 'ws';
import { CloudToGlassesMessageType } from '@augmentos/sdk';

const logger = rootLogger.child({ service: 'location.service' });

// The order of this array defines the priority. 'realtime' is highest.
const TIER_HIERARCHY = ['reduced', 'threeKilometers', 'kilometer', 'hundredMeters', 'tenMeters', 'high', 'realtime'];

class LocationService {

  /**
   * This is the main entry point for the streaming logic.
   * It's called by websocket-tpa.service.ts whenever a TPA's subscriptions change.
   */
  public async handleSubscriptionChange(userId: string): Promise<void> {
    const user = await User.findOne({ email: userId });
    if (!user) {
      logger.warn({ userId }, "User not found during location subscription change.");
      return;
    }
    
    const previousEffectiveRate = user.effective_location_rate || 'reduced';
    const newEffectiveRate = this._calculateEffectiveRateForUser(user);

    if (newEffectiveRate !== previousEffectiveRate) {
      logger.info({ userId, oldRate: previousEffectiveRate, newRate: newEffectiveRate }, "Effective location rate has changed. Updating database and commanding device.");
      
      // Persist the new effective rate to the database
      user.effective_location_rate = newEffectiveRate;
      await user.save();
      
      // Send the command to the physical device
      const userSession = sessionService.getSessionByUserId(userId);
      if (userSession?.websocket && userSession.websocket.readyState === WebSocket.OPEN) {
        this._sendCommandToDevice(userSession.websocket, 'SET_LOCATION_TIER', { rate: newEffectiveRate });
      } else {
        logger.warn({ userId }, "User session or WebSocket not available to send location tier command.");
      }
    } else {
      logger.info({ userId, rate: newEffectiveRate }, "Location subscriptions changed, but effective rate remains the same. No command sent.");
    }
  }

  /**
   * This is the placeholder for the polling logic, which we will implement later.
   */
  public async handlePollRequest(userId: string, accuracy: string): Promise<void> {
    logger.info({ userId, accuracy }, "Handling poll request for location service. (Logic to be implemented)");
    // The full Intelligent Poll algorithm will be implemented here in Phase 2.
  }

  /**
   * Calculates the highest tier requested by any of the user's active TPAs.
   */
  private _calculateEffectiveRateForUser(user: UserI): string {
    const defaultRate = 'reduced';
    if (!user.location_subscriptions || user.location_subscriptions.size === 0) {
      return defaultRate;
    }

    let highestTierIndex = -1;

    // The user document stores a map of: packageName -> { rate: '...' }
    // We iterate through all the stored rates for this user.
    for (const subDetails of user.location_subscriptions.values()) {
      const tierIndex = TIER_HIERARCHY.indexOf(subDetails.rate);
      if (tierIndex > highestTierIndex) {
        highestTierIndex = tierIndex;
      }
    }

    return highestTierIndex > -1 ? TIER_HIERARCHY[highestTierIndex] : defaultRate;
  }

  /**
   * Sends a command to the device's native WebSocket connection.
   */
  private _sendCommandToDevice(ws: WebSocket, type: string, payload: any): void {
    try {
      const message = {
        type: type,
        payload: payload,
        timestamp: new Date().toISOString()
      };
      ws.send(JSON.stringify(message));
      logger.info({ type, payload }, "Successfully sent command to device.");
    } catch (error) {
        logger.error({error, type}, "Failed to send command to device.")
    }
  }
}

export const locationService = new LocationService();
logger.info("Location Service initialized."); 