const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

/**
 * Triggered when a new message is created in any chat room.
 * Sends a high-priority push notification to the recipient of the message.
 */
exports.sendPushNotification = functions.database.ref('/messages/{roomId}/{messageId}')
    .onCreate(async (snapshot, context) => {
        const message = snapshot.val();
        const { roomId } = context.params;

        // 1. Determine who needs to receive the notification
        // We find the other user in this room who is NOT the sender
        const userChatsRef = admin.database().ref('/user_chats');
        const userChatsSnap = await userChatsRef.once('value');
        const allUserChats = userChatsSnap.val();

        if (!allUserChats) return null;

        let recipientId = null;
        let senderName = message.senderName || 'Nexurao User';

        // Iterate through all users to find who has this roomId in their chat list, 
        // but isn't the person who sent it.
        for (const [userId, chats] of Object.entries(allUserChats)) {
            if (chats && chats[roomId] && userId !== message.senderId) {
                recipientId = userId;
                break;
            }
        }

        if (!recipientId) {
            console.log('No recipient found for push notification.');
            return null;
        }

        // 2. Get the recipient's FCM token
        const recipientRef = admin.database().ref(`/users/${recipientId}`);
        const recipientSnap = await recipientRef.once('value');
        const recipientData = recipientSnap.val();

        if (!recipientData || !recipientData.fcmToken) {
            console.log(`User ${recipientId} has no FCM token saved.`);
            return null;
        }

        const fcmToken = recipientData.fcmToken;

        // 3. Construct and send the push notification
        const payload = {
            token: fcmToken,
            notification: {
                title: `Message from ${senderName}`,
                body: message.text || '📷 Sent a media message',
            },
            data: {
                roomId: roomId,
                senderId: message.senderId,
                senderName: senderName,
                click_action: 'OPEN_CHAT', // Used by some custom listeners
            },
            android: {
                priority: 'high',
                notification: {
                    channel_id: 'messages',
                    small_icon: 'ic_stat_notification',
                    color: '#22d3ee',
                    sound: 'default'
                }
            }
        };

        try {
            await admin.messaging().send(payload);
            console.log(`Successfully sent push notification to ${recipientId}`);
        } catch (error) {
            console.error('Error sending push notification:', error);
        }

        return null;
    });
