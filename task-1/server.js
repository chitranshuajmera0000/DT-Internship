import dotenv from 'dotenv';
import { connectToDatabase } from './db.js';
import express from 'express';
import { ObjectId } from 'mongodb';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

dotenv.config();

const app = express();

app.use(express.json());

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Configure multer to accept files[image]
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, `${unique}-${file.originalname}`);
    }
});
const upload = multer({ storage });

app.use('/uploads', express.static(uploadsDir));

const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        const db = await connectToDatabase();
        const eventsCollection = db.collection('events');

        // Helper: check duplicates by name + schedule. Returns true if another matching event exists.
        async function isDuplicateEvent(collection, doc, excludeId = null) {
            if (!doc || !doc.name || !doc.schedule) return false; // require both name and schedule to consider duplicate
            const date = new Date(doc.schedule);
            if (isNaN(date)) return false; // can't normalize schedule, skip duplicate check
            const iso = date.toISOString();
            const query = {
                name: doc.name,
                $or: [
                    { schedule: date },
                    { schedule: iso },
                    { schedule: doc.schedule }
                ]
            };
            if (excludeId) {
                query._id = { $ne: excludeId };
            }
            const existing = await collection.findOne(query);
            return !!existing;
        }

        // Single GET endpoint that supports ?id= or ?type=latest&limit=&page=
        app.get('/api/v3/app/events', async (req, res) => {
            try {
                const { id, type, limit = 5, page = 1 } = req.query;

                if (id) {
                    // fetch by ObjectId
                    let objId;
                    try {
                        objId = new ObjectId(id);
                    } catch (err) {
                        return res.status(400).json({ error: 'Invalid id format' });
                    }
                    const event = await eventsCollection.findOne({ _id: objId });
                    if (!event) return res.status(404).json({ error: 'Event not found' });
                    return res.status(200).json(event);
                }

                if (type === 'latest') {
                    const lim = parseInt(limit) || 5;
                    const pg = Math.max(1, parseInt(page) || 1);
                    const skip = (pg - 1) * lim;
                    const events = await eventsCollection.find({})
                        .sort({ schedule: -1 })
                        .skip(skip)
                        .limit(lim)
                        .toArray();
                    return res.status(200).json(events);
                }

                // default: return paginated list by page/limit without special sorting
                const lim = parseInt(limit) || 5;
                const pg = Math.max(1, parseInt(page) || 1);
                const skip = (pg - 1) * lim;
                const events = await eventsCollection.find({})
                    .skip(skip)
                    .limit(lim)
                    .toArray();
                return res.status(200).json(events);
            } catch (err) {
                console.error('Error fetching events:', err);
                return res.status(500).json({ error: 'Internal Server Error' });
            }
        });

        // Create event - accept multipart/form-data with files[image]
        app.post('/api/v3/app/events', upload.single('files[image]'), async (req, res) => {
            try {
                // allow flexible payloads (minimal required: name + schedule)
                const body = req.body || {};

                // normalize common aliases so clients can send camelCase or snake_case
                body.sub_category = body.sub_category || body.subCategory;
                body.rigor_rank = body.rigor_rank || body.rigorRank || body.rigor;
                body.moderator = body.moderator || body.moderatorId || body.moderator_name;

                // coerce numeric fields when provided as strings
                if (body.rigor_rank && typeof body.rigor_rank === 'string') {
                    const r = parseInt(body.rigor_rank, 10);
                    if (!Number.isNaN(r)) body.rigor_rank = r;
                }

                // minimal required check: name and schedule
                const required = ['name', 'schedule'];
                const missing = required.filter(f => (body[f] === undefined || body[f] === ''));
                if (missing.length > 0) {
                    return res.status(400).json({ error: 'Missing required fields', missing });
                }

                // check duplicates (only if name+schedule are present)
                if (await isDuplicateEvent(eventsCollection, body)) {
                    return res.status(409).json({ error: 'Duplicate event (same name and schedule)'});
                }
                
                const eventDoc = { ...body };

                // attach file info if uploaded
                if (req.file) {
                    eventDoc.files = eventDoc.files || {};
                    eventDoc.files.image = `/uploads/${req.file.filename}`; // save relative URL
                }

                // attendees may come as JSON string, try to parse
                if (eventDoc.attendees && typeof eventDoc.attendees === 'string') {
                    try { eventDoc.attendees = JSON.parse(eventDoc.attendees); } catch (e) { /* leave as string */ }
                }

                // Check for duplicates before inserting
                const isDuplicate = await isDuplicateEvent(eventsCollection, eventDoc);
                if (isDuplicate) {
                    return res.status(409).json({ error: 'Duplicate event found', fields: ['name', 'schedule'] });
                }

                const result = await eventsCollection.insertOne(eventDoc);
                return res.status(201).json({ message: 'Event created successfully', eventId: result.insertedId });
            } catch (err) {
                console.error('Error creating event:', err);
                return res.status(500).json({ error: 'Internal Server Error' });
            }
        });

        // Update event - accept multipart/form-data optionally
        app.put('/api/v3/app/events/:id', upload.single('files[image]'), async (req, res) => {
            try {
                const { id } = req.params;
                if (!id) return res.status(400).json({ error: 'ID parameter is required' });
                let objId;
                try { objId = new ObjectId(id); } catch (err) { return res.status(400).json({ error: 'Invalid id format' }); }
 
                const updateData = { ...req.body };
                // normalize common aliases so clients can send camelCase or snake_case
                updateData.sub_category = updateData.sub_category || updateData.subCategory;
                updateData.rigor_rank = updateData.rigor_rank || updateData.rigorRank || updateData.rigor;
                updateData.moderator = updateData.moderator || updateData.moderatorId || updateData.moderator_name;
                if (updateData.rigor_rank && typeof updateData.rigor_rank === 'string') {
                    const r = parseInt(updateData.rigor_rank, 10);
                    if (!Number.isNaN(r)) updateData.rigor_rank = r;
                }
                // check duplicates excluding this id (only if name+schedule present in update)
                if ((updateData.name || updateData.schedule) && await isDuplicateEvent(eventsCollection, updateData, objId)) {
                    return res.status(409).json({ error: 'Duplicate event (same name and schedule)'});
                }
                if (req.file) {
                    updateData.files = updateData.files || {};
                    updateData.files.image = `/uploads/${req.file.filename}`;
                }

                // Check for duplicates before updating
                const isDuplicate = await isDuplicateEvent(eventsCollection, updateData, objId);
                if (isDuplicate) {
                    return res.status(409).json({ error: 'Duplicate event found', fields: ['name', 'schedule'] });
                }

                const result = await eventsCollection.updateOne({ _id: objId }, { $set: updateData });
                if (result.matchedCount === 0) return res.status(404).json({ error: 'Event not found' });
                return res.status(200).json({ message: 'Event updated successfully' });
            } catch (err) {
                console.error('Error updating event:', err);
                return res.status(500).json({ error: 'Internal Server Error' });
            }
        });

        // Delete event
        app.delete('/api/v3/app/events/:id', async (req, res) => {
            try {
                const { id } = req.params;
                if (!id) return res.status(400).json({ error: 'ID parameter is required' });
                let objId;
                try { objId = new ObjectId(id); } catch (err) { return res.status(400).json({ error: 'Invalid id format' }); }

                const result = await eventsCollection.deleteOne({ _id: objId });
                if (result.deletedCount === 0) return res.status(404).json({ error: 'Event not found' });
                return res.status(200).json({ message: 'Event deleted successfully' });
            } catch (err) {
                console.error('Error deleting event:', err);
                return res.status(500).json({ error: 'Internal Server Error' });
            }
        });

        app.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
        });

    } catch (err) {
        console.error('Failed to start server due to database connection error:', err);
        process.exit(1);
    }
}

startServer();