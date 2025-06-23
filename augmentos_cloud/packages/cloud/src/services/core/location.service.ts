import { User, UserI } from '../../models/user.model';
import { sessionService } from '../session/session.service';
import subscriptionService from '../session/subscription.service';
import { logger as rootLogger } from '../logging/pino-logger';
import WebSocket from 'ws';

const logger = rootLogger.child({ service: 'location.service' });

const TIER_ORDER = ['reduced', 'threeKilometers', 'kilometer', 'hundredMeters', 'tenMeters', 'high', 'realtime'];

class LocationService {

  public async handleSubscriptionChange(userId: string): Promise<void> {
    const user = await User.findOne({ email: userId });
    if (!user) {
      logger.warn({ userId }, "User not found during location subscription change.");
      return;
    }
    
    const previousEffectiveRate = user.effective_location_rate || 'reduced';
    const newEffectiveRate = this._calculateEffectiveRateForUser(user);

    if (newEffectiveRate !== previousEffectiveRate) {
      logger.info({ userId, oldRate: previousEffectiveRate, newRate: newEffectiveRate }, "Effective location rate changed.");
      user.effective_location_rate = newEffectiveRate;
      await user.save();
      
      const userSession = sessionService.getSessionByUserId(userId);
      if (userSession?.websocket && userSession.websocket.readyState === WebSocket.OPEN) {
        this._sendCommandToDevice(userSession.websocket, 'SET_LOCATION_TIER', { rate: newEffectiveRate });
      } else {
        logger.warn({ userId }, "User session or WebSocket not available to send location tier command.");
      }
    }
  }

  public async handlePollRequest(userId: string, accuracy: string): Promise<void> {
    const user = await User.findOne({ email: userId });
    if (!user) {
      logger.warn({ userId }, "User not found during location poll request.");
      return;
    }

    const userSession = sessionService.getSessionByUserId(userId);
    if (!userSession?.websocket || userSession.websocket.readyState !== WebSocket.OPEN) {
      logger.warn({ userId }, "User session or WebSocket not available for poll request.");
      return;
    }
    
    // Step 1: Check for a high-accuracy active stream
    const currentEffectiveRate = user.effective_location_rate || 'reduced';
    const highAccuracyStreamRunning = TIER_ORDER.indexOf(currentEffectiveRate) >= TIER_ORDER.indexOf('high');

    if (highAccuracyStreamRunning) {
        const lastLocation = subscriptionService.getLastLocation(userSession.sessionId);
        if(lastLocation){
            logger.info({ userId, accuracy }, "Fulfilling poll request from active high-accuracy stream.");
            // TODO: We need to add correlationId to the message sent back to the TPA
            // This requires modifying the relay logic to include it.
            return; 
        }
    }

    // Step 2: Check cache (logic to be implemented, requires timestamp on user.location)
    // For now, we proceed to a hardware poll.
    
    // Step 3: Trigger hardware poll
    logger.info({ userId, accuracy }, "No active stream or fresh cache, requesting hardware poll.");
    this._sendCommandToDevice(userSession.websocket, 'REQUEST_SINGLE_LOCATION', { accuracy });
  }

  private _calculateEffectiveRateForUser(user: UserI): string {
    if (!user.location_subscriptions || user.location_subscriptions.size === 0) {
      return 'reduced'; // Default if no subscriptions
    }

    let highestTierIndex = -1;

    for (const sub of user.location_subscriptions.values()) {
      const rate = sub.rate;
      const tierIndex = TIER_ORDER.indexOf(rate);
      if (tierIndex > highestTierIndex) {
        highestTierIndex = tierIndex;
      }
    }

    return highestTierIndex > -1 ? TIER_ORDER[highestTierIndex] : 'reduced';
  }

  private _sendCommandToDevice(ws: WebSocket, type: string, payload: any): void {
    try {
      const message = {
        type: type,
        payload: payload,
        timestamp: new Date().toISOString()
      };
      ws.send(JSON.stringify(message));
    } catch (error) {
        logger.error({error, type}, "Failed to send command to device.")
    }
  }
}

export const locationService = new LocationService();
logger.info("Location Service initialized."); 