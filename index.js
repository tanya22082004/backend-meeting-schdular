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

// MEETINGS API ENDPOINTS

// Create a new meeting
app.post('/api/meetings', authenticateUser, async (req, res) => {
  try {
    const { title, date, location, notes } = req.body;
    
    // Validate required fields
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
      participants: [],
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
    
    const meetingsQuery = db.collection('meetings')
      .where('createdBy', '==', userId)
      .orderBy('date', 'asc');
    
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

// Update a meeting
app.put('/api/meetings/:id', authenticateUser, async (req, res) => {
  try {
    const meetingId = req.params.id;
    const userId = req.user.uid;
    const { title, date, location, notes } = req.body;
    
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

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Meeting Scheduler API server is running on port ${PORT}`);
});

export default app;