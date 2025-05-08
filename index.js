// Import required packages
import express from 'express';
import admin from 'firebase-admin';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import dotenv from 'dotenv';
import cors from 'cors';

// Load environment variables
dotenv.config();

// Initialize Express
const app = express();
app.use(express.json());
app.use(cors());

// Firebase configuration
const firebaseConfig = {
  credential: admin.credential.applicationDefault(),
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET
};

// Initialize Firebase Admin
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = admin.firestore();

// Make Firebase services available to all routes
app.use((req, res, next) => {
  req.auth = auth;
  req.db = db;
  next();
});

// Authentication middleware
const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized - Missing or invalid token format' });
    }

    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({ error: 'Unauthorized - Invalid token' });
  }
};

// Root endpoint
app.get('/', (req, res) => {
  res.send('Meeting Scheduler API is running');
});

// Test Firebase connection
app.get('/test-firebase', async (req, res) => {
  try {
    // Test Firebase Auth connection
    const authStatus = auth ? "Connected to Firebase Auth" : "Failed to connect to Firebase Auth";
    
    // Test Firestore connection by attempting to read data
    let firestoreStatus = "Unknown";
    try {
      // Create a test collection if it doesn't exist and add a test document
      const testRef = await db.collection('connection_tests').add({
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        message: "Test connection successful"
      });
      
      // Attempt to read from the collection
      const querySnapshot = await db.collection('connection_tests').get();
      const docCount = querySnapshot.size;
      
      firestoreStatus = `Connected to Firestore. Found ${docCount} test documents.`;
    } catch (dbError) {
      console.error("Firestore test error:", dbError);
      firestoreStatus = `Failed to connect to Firestore: ${dbError.message}`;
    }
    
    // Return connection status
    res.json({
      success: true,
      firebase: {
        auth: authStatus,
        firestore: firestoreStatus,
        config: {
          projectId: firebaseConfig.projectId,
          storageBucket: firebaseConfig.storageBucket
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Firebase connection test failed:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// MEETINGS API ENDPOINTS

// Create a new meeting
app.post('/api/meetings', authenticateUser, async (req, res) => {
  try {
    const { title, date, location, notes, participants } = req.body;
    
    if (!title) {
      return res.status(400).json({ error: 'Meeting title is required' });
    }

    // Validate date format
    const meetingDate = date ? new Date(date) : new Date();
    if (isNaN(meetingDate)) {
      return res.status(400).json({ error: 'Invalid date format' });
    }

    // Create meeting document
    const meetingData = {
      title,
      date: meetingDate.toISOString(),
      location: location || '',
      notes: notes || '',
      participants: participants || [],
      createdBy: req.user.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const meetingRef = await db.collection('meetings').add(meetingData);

    res.status(201).json({ 
      success: true,
      message: 'Meeting created successfully', 
      meeting: {
        id: meetingRef.id,
        ...meetingData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error creating meeting:', error);
    res.status(500).json({ error: 'Failed to create meeting', details: error.message });
  }
});

// Get all meetings for the authenticated user
app.get('/api/meetings', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.uid;
    
    // You could also filter by participants or other criteria
    const meetingsQuery = db.collection('meetings').where('createdBy', '==', userId);
    
    const querySnapshot = await meetingsQuery.get();
    
    const meetings = [];
    querySnapshot.forEach((doc) => {
      const meetingData = doc.data();
      meetings.push({
        id: doc.id,
        ...meetingData,
        createdAt: meetingData.createdAt ? meetingData.createdAt.toDate().toISOString() : null,
        updatedAt: meetingData.updatedAt ? meetingData.updatedAt.toDate().toISOString() : null
      });
    });
    
    res.status(200).json({ meetings });
  } catch (error) {
    console.error('Error getting meetings:', error);
    res.status(500).json({ error: 'Failed to retrieve meetings', details: error.message });
  }
});

// Get meetings where user is a participant
app.get('/api/meetings/participating', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.uid;
    
    const meetingsQuery = db.collection('meetings').where('participants', 'array-contains', userId);
    
    const querySnapshot = await meetingsQuery.get();
    
    const meetings = [];
    querySnapshot.forEach((doc) => {
      const meetingData = doc.data();
      meetings.push({
        id: doc.id,
        ...meetingData,
        createdAt: meetingData.createdAt ? meetingData.createdAt.toDate().toISOString() : null,
        updatedAt: meetingData.updatedAt ? meetingData.updatedAt.toDate().toISOString() : null
      });
    });
    
    res.status(200).json({ meetings });
  } catch (error) {
    console.error('Error getting participant meetings:', error);
    res.status(500).json({ error: 'Failed to retrieve meetings', details: error.message });
  }
});

// Get a specific meeting by ID
app.get('/api/meetings/:id', authenticateUser, async (req, res) => {
  try {
    const meetingId = req.params.id;
    const userId = req.user.uid;
    
    const meetingRef = db.collection('meetings').doc(meetingId);
    const meetingSnap = await meetingRef.get();
    
    if (!meetingSnap.exists) {
      return res.status(404).json({ error: 'Meeting not found' });
    }
    
    const meetingData = meetingSnap.data();
    
    // Check if user has access to the meeting (creator or participant)
    if (meetingData.createdBy !== userId && 
        !meetingData.participants?.includes(userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    res.status(200).json({
      id: meetingSnap.id,
      ...meetingData,
      createdAt: meetingData.createdAt ? meetingData.createdAt.toDate().toISOString() : null,
      updatedAt: meetingData.updatedAt ? meetingData.updatedAt.toDate().toISOString() : null
    });
  } catch (error) {
    console.error('Error getting meeting:', error);
    res.status(500).json({ error: 'Failed to retrieve meeting', details: error.message });
  }
});

// Update a meeting
app.put('/api/meetings/:id', authenticateUser, async (req, res) => {
  try {
    const meetingId = req.params.id;
    const userId = req.user.uid;
    const { title, date, location, notes, participants } = req.body;
    
    // Check if meeting exists
    const meetingRef = db.collection('meetings').doc(meetingId);
    const meetingSnap = await meetingRef.get();
    
    if (!meetingSnap.exists) {
      return res.status(404).json({ error: 'Meeting not found' });
    }
    
    const meetingData = meetingSnap.data();
    
    // Check if user is the creator
    if (meetingData.createdBy !== userId) {
      return res.status(403).json({ error: 'Only the meeting creator can update it' });
    }
    
    // Validate date if provided
    let meetingDate = meetingData.date;
    if (date) {
      const newDate = new Date(date);
      if (isNaN(newDate)) {
        return res.status(400).json({ error: 'Invalid date format' });
      }
      meetingDate = newDate.toISOString();
    }
    
    // Update meeting with only the provided fields
    const updateData = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    if (title !== undefined) updateData.title = title;
    if (meetingDate !== undefined) updateData.date = meetingDate;
    if (location !== undefined) updateData.location = location;
    if (notes !== undefined) updateData.notes = notes;
    if (participants !== undefined) updateData.participants = participants;
    
    await meetingRef.update(updateData);
    
    // Get the updated document
    const updatedMeetingSnap = await meetingRef.get();
    const updatedMeetingData = updatedMeetingSnap.data();
    
    res.status(200).json({
      success: true,
      message: 'Meeting updated successfully',
      meeting: {
        id: meetingId,
        ...updatedMeetingData,
        createdAt: updatedMeetingData.createdAt ? updatedMeetingData.createdAt.toDate().toISOString() : null,
        updatedAt: updatedMeetingData.updatedAt ? updatedMeetingData.updatedAt.toDate().toISOString() : null
      }
    });
  } catch (error) {
    console.error('Error updating meeting:', error);
    res.status(500).json({ error: 'Failed to update meeting', details: error.message });
  }
});

// Delete a meeting
app.delete('/api/meetings/:id', authenticateUser, async (req, res) => {
  try {
    const meetingId = req.params.id;
    const userId = req.user.uid;
    
    // Check if meeting exists
    const meetingRef = db.collection('meetings').doc(meetingId);
    const meetingSnap = await meetingRef.get();
    
    if (!meetingSnap.exists) {
      return res.status(404).json({ error: 'Meeting not found' });
    }
    
    const meetingData = meetingSnap.data();
    
    // Check if user is the creator
    if (meetingData.createdBy !== userId) {
      return res.status(403).json({ error: 'Only the meeting creator can delete it' });
    }
    
    // Delete the meeting
    await meetingRef.delete();
    
    res.status(200).json({
      success: true,
      message: 'Meeting deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting meeting:', error);
    res.status(500).json({ error: 'Failed to delete meeting', details: error.message });
  }
});

// Add participant to a meeting
app.post('/api/meetings/:id/participants', authenticateUser, async (req, res) => {
  try {
    const meetingId = req.params.id;
    const userId = req.user.uid;
    const { participantId } = req.body;
    
    if (!participantId) {
      return res.status(400).json({ error: 'Participant ID is required' });
    }
    
    // Check if meeting exists
    const meetingRef = db.collection('meetings').doc(meetingId);
    const meetingSnap = await meetingRef.get();
    
    if (!meetingSnap.exists) {
      return res.status(404).json({ error: 'Meeting not found' });
    }
    
    const meetingData = meetingSnap.data();
    
    // Check if user is the creator
    if (meetingData.createdBy !== userId) {
      return res.status(403).json({ error: 'Only the meeting creator can add participants' });
    }
    
    // Get current participants or initialize empty array
    const participants = meetingData.participants || [];
    
    // Check if participant already exists
    if (participants.includes(participantId)) {
      return res.status(400).json({ error: 'Participant already added to meeting' });
    }
    
    // Add the new participant
    participants.push(participantId);
    
    // Update the meeting
    await meetingRef.update({
      participants,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    res.status(200).json({
      success: true,
      message: 'Participant added successfully',
      participants
    });
  } catch (error) {
    console.error('Error adding participant:', error);
    res.status(500).json({ error: 'Failed to add participant', details: error.message });
  }
});

// Remove participant from a meeting
app.delete('/api/meetings/:id/participants/:participantId', authenticateUser, async (req, res) => {
  try {
    const meetingId = req.params.id;
    const userId = req.user.uid;
    const participantId = req.params.participantId;
    
    // Check if meeting exists
    const meetingRef = db.collection('meetings').doc(meetingId);
    const meetingSnap = await meetingRef.get();
    
    if (!meetingSnap.exists) {
      return res.status(404).json({ error: 'Meeting not found' });
    }
    
    const meetingData = meetingSnap.data();
    
    // Check if user is the creator or removing themselves
    if (meetingData.createdBy !== userId && userId !== participantId) {
      return res.status(403).json({ error: 'Unauthorized to remove this participant' });
    }
    
    // Get current participants
    const participants = meetingData.participants || [];
    
    // Check if participant exists
    if (!participants.includes(participantId)) {
      return res.status(400).json({ error: 'Participant not found in meeting' });
    }
    
    // Remove the participant
    const updatedParticipants = participants.filter(id => id !== participantId);
    
    // Update the meeting
    await meetingRef.update({
      participants: updatedParticipants,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    res.status(200).json({
      success: true,
      message: 'Participant removed successfully',
      participants: updatedParticipants
    });
  } catch (error) {
    console.error('Error removing participant:', error);
    res.status(500).json({ error: 'Failed to remove participant', details: error.message });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Meeting Scheduler API server is running on port ${PORT}`);
});

export default app;