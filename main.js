import Alpine from 'alpinejs'
import './style.css'
import { supabase } from './supabaseClient'

window.Alpine = Alpine

Alpine.data('manpowerApp', () => ({
    // State
    eventId: null,
    currentView: 'list',
    eventsList: [],

    eventData: {
        date: '',
        day: '',
        location: '',
        schedule: '',
        reportTime: '',
        targetCount: 15,
        boys: []
    },

    // UI
    isAdminModalOpen: false,
    isUpdateListModalOpen: false,
    pastedText: '',

    // Logic
    isUpdating: false, // Lock for sequential updates

    async init() {
        console.log("Admin App Initialized (Reset v2.0) 🛡️");
        await this.loadEventsList();
    },

    async loadEventsList() {
        const { data: events } = await supabase.from('events').select('*').order('created_at', { ascending: false });
        this.eventsList = events || [];
    },

    async selectEvent(event) {
        this.eventId = event.id;
        this.eventData = {
            ...this.eventData, ...{
                date: event.date,
                day: event.day,
                location: event.location,
                schedule: event.schedule,
                reportTime: event.report_time,
                targetCount: event.target_count
            }
        };
        this.currentView = 'detail';
        await this.loadBoys();
    },

    openCreateEvent() {
        this.resetData();
        this.currentView = 'detail';
        this.isUpdateListModalOpen = true;
    },

    backToDashboard() {
        this.currentView = 'list';
        this.eventId = null;
    },

    resetData() {
        this.eventId = null;
        this.eventData = {
            date: '', day: '', location: '', schedule: '', reportTime: '', targetCount: 15, boys: []
        };
    },

    async loadBoys() {
        if (!this.eventId) return;
        const { data: boys } = await supabase
            .from('boys')
            .select('*')
            .eq('event_id', this.eventId)
            .order('roll_no', { ascending: true }); // STRICT ORDER

        if (boys) {
            this.eventData.boys = boys.map(b => ({
                id: b.id,
                rollNo: b.roll_no,
                name: b.name,
                mobile: b.mobile,
                status: b.status,
                uniformChecked: b.uniform_checked,
                fines: b.fines || []
            }));
        }
    },

    // --- Core Logic: Parsing (Sticky Footer Removal + Roll No) ---

    async parseWhatsAppText() {
        if (!this.pastedText) return;
        let text = this.pastedText;
        console.log("Parsing...");

        // 1. Remove Footer
        const stopPhrases = ['❌', 'Interested boys mention names', 'READ THE DESCRIPTION'];
        for (const phrase of stopPhrases) {
            if (text.includes(phrase)) text = text.split(phrase)[0];
        }

        const lines = text.split('\n');

        // Metadata Extraction (Regex)
        // Simple extractions for Date, Location etc.
        const dateMatch = text.match(/(?:DATE|Date)\s*[:\-]?\s*\*?([0-9\/]+)\*?/);
        if (dateMatch) this.eventData.date = dateMatch[1].trim();

        const locMatch = text.match(/(?:LOCATION|Location)\s*[:\-]?\s*\*?([A-Za-z\s]+)\*?/);
        if (locMatch) this.eventData.location = locMatch[1].trim();

        // Boys Parsing
        const boysToInsert = [];
        let sectionStarted = false;

        lines.forEach(line => {
            let clean = line.replace(/```/g, '').trim();
            if (/BOYS/i.test(clean)) sectionStarted = true;

            // Look for "1. Name"
            const match = clean.match(/^(\d+)[\.\)]\s*(.*)/);
            if (match) {
                // Even if section didn't auto-start, "1." triggers it usually
                sectionStarted = true;
                const rollNo = parseInt(match[1], 10);
                let content = match[2];

                // Remove phone numbers if any
                content = content.replace(/(?:\+91[\-\s]?)?[6789]\d{9}/, '').trim();
                let name = content.replace(/[\*\-]/g, '').trim();

                if (name.length > 2) {
                    boysToInsert.push({ rollNo, name, mobile: '' });
                }
            }
        });

        // Merge keeping existing status if name matches
        const finalBoys = boysToInsert.map(newBoy => {
            const existing = this.eventData.boys.find(b => b.name.toLowerCase() === newBoy.name.toLowerCase());
            return {
                rollNo: newBoy.rollNo,
                name: newBoy.name,
                mobile: existing ? existing.mobile : '',
                status: existing ? existing.status : 'pending',
                uniformChecked: existing ? existing.uniformChecked : false,
                fines: existing ? existing.fines : []
            };
        });

        this.eventData.boys = finalBoys;
        this.isUpdateListModalOpen = false;

        // Auto-Save after update?
        // Let's ask user to click Save to be sure.
        alert("List Parsed! Click 'Save & Publish' to sync.");
    },

    // --- Core Logic: Saving (Overwrite Strategy) ---

    async saveEventToSupabase() {
        if (!this.eventData.location) return alert("Need Location!");

        try {
            // 1. Upsert Event
            const payload = {
                date: this.eventData.date,
                day: this.eventData.day, // Todo: Calc day
                location: this.eventData.location,
                schedule: this.eventData.schedule,
                report_time: this.eventData.reportTime,
                target_count: this.eventData.targetCount
            };

            let currentEventId = this.eventId;
            if (currentEventId) {
                await supabase.from('events').update(payload).eq('id', currentEventId);
            } else {
                const { data } = await supabase.from('events').insert([payload]).select();
                currentEventId = data[0].id;
                this.eventId = currentEventId;
            }

            // 2. Overwrite Boys (Sequential)
            // Delete All
            await supabase.from('boys').delete().eq('event_id', currentEventId);

            // Insert All (Loop for sequence)
            for (const b of this.eventData.boys) {
                await new Promise(r => setTimeout(r, 20)); // Safety delay
                await supabase.from('boys').insert([{
                    event_id: currentEventId,
                    roll_no: b.rollNo, // CRITICAL
                    name: b.name,
                    mobile: b.mobile,
                    status: b.status,
                    uniform_checked: b.uniformChecked,
                    fines: b.fines
                }]);
            }

            alert("Saved & Sync Complete! ✅");
        } catch (e) {
            console.error(e);
            alert("Save Failed: " + e.message);
        }
    },

    // Getters
    get presentCount() { return this.eventData.boys.filter(b => b.status === 'in' || b.status === 'out').length; }
}))

Alpine.start()
