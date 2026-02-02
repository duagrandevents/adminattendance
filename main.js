import Alpine from 'alpinejs'
import './style.css'
import { supabase } from './supabaseClient'

window.Alpine = Alpine

Alpine.data('manpowerApp', () => ({
    eventId: null,
    currentView: 'list', // 'list' | 'detail'
    eventsList: [],

    eventData: {
        date: '',
        day: '',
        reportTime: '',
        location: '',
        schedule: '',
        targetCount: 15,
        boys: []
    },

    // UI State for Modals
    isUpdateListModalOpen: false,
    isEditEventModalOpen: false,
    isEditBoyModalOpen: false,
    isAdminModalOpen: false,

    // Temporary state for editing
    editingBoyIndex: null,
    editingBoyData: { name: '', mobile: '' },
    pastedText: '',

    // Admin State
    adminMode: true,
    isUnsaved: false,

    async init() {
        console.log("Initializing Admin App...");
        await this.loadEventsList();
        this.setupRealtime();

        // Mobile-friendly: fix height
        const setVh = () => {
            let vh = window.innerHeight * 0.01;
            document.documentElement.style.setProperty('--vh', `${vh}px`);
        };
        window.addEventListener('resize', setVh);
        setVh();
    },

    async loadEventsList() {
        const { data: events, error } = await supabase
            .from('events')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching events:', error);
        } else {
            this.eventsList = events || [];
        }
    },

    openCreateEvent() {
        this.resetEventData();
        this.currentView = 'detail';
        this.isUpdateListModalOpen = true;
    },

    async selectEvent(event) {
        this.eventId = event.id;
        this.eventData.date = event.date;
        this.eventData.day = event.day;
        this.eventData.location = event.location;
        this.eventData.schedule = event.schedule;
        this.eventData.reportTime = event.report_time;
        this.eventData.targetCount = event.target_count;
        this.currentView = 'detail';
        await this.loadBoys();
    },

    resetEventData() {
        this.eventId = null;
        this.eventData = {
            date: '',
            day: '',
            reportTime: '',
            location: '',
            schedule: '',
            targetCount: 15,
            boys: []
        };
    },

    backToDashboard() {
        this.currentView = 'list';
        this.refreshDashboard();
    },

    async refreshDashboard() {
        await this.loadEventsList();
    },


    async loadBoys() {
        if (!this.eventId) return;
        const { data: boys, error } = await supabase
            .from('boys')
            .select('*')
            .eq('event_id', this.eventId)
            .order('created_at', { ascending: true });

        if (error) {
            console.error('Error fetching boys:', error);
        } else {
            // Map DB fields to UI fields
            this.eventData.boys = boys.map(b => ({
                id: b.id,
                name: b.name,
                mobile: b.mobile,
                status: b.status,
                uniformChecked: b.uniform_checked,
                fines: b.fines || []
            }));
        }
    },

    setupRealtime() {
        supabase
            .channel('public:any')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, payload => {
                console.log('Event changed!', payload);
                this.loadEventsList();
                // If we are in detail view, we might want to refresh that too, but list is priority for dashboard
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'boys' }, payload => {
                console.log('Boys changed!', payload);
                this.loadBoys(); // Refresh list
            })
            .subscribe();
    },

    async createOrUpdateEvent() {
        const payload = {
            date: this.eventData.date,
            day: this.eventData.day,
            location: this.eventData.location,
            schedule: this.eventData.schedule,
            target_count: this.eventData.targetCount,
            report_time: this.eventData.reportTime
        };

        if (this.eventId) {
            await supabase.from('events').update(payload).eq('id', this.eventId);
        } else {
            const { data, error } = await supabase.from('events').insert([payload]).select();
            if (data) {
                this.eventId = data[0].id;
                // If we implemented 'boys' locally before event existed, we might need to sync them?
                // For now, let's assume 'Update List' triggers this.
            }
        }
    },

    // --- Computed Properties ---
    get presentCount() {
        return this.eventData.boys.filter(b => b.status === 'in' || b.status === 'out').length;
    },

    get dressCount() {
        return this.eventData.boys.filter(b => b.uniformChecked).length;
    },

    get outCount() {
        return this.eventData.boys.filter(b => b.status === 'out').length;
    },

    get fillPercentage() {
        if (this.eventData.targetCount === 0) return 0;
        return Math.min(100, Math.round((this.eventData.boys.length / this.eventData.targetCount) * 100));
    },

    // --- Actions ---

    async addBoy(name, mobile) {
        if (this.eventData.boys.length >= this.eventData.targetCount) {
            alert('Target reached!');
            return;
        }

        if (!this.eventId) {
            await this.createOrUpdateEvent();
        }

        const newBoy = {
            event_id: this.eventId,
            name: name,
            mobile: mobile,
            status: 'pending',
            uniform_checked: false,
            fines: []
        };

        const { error } = await supabase.from('boys').insert([newBoy]);
        if (error) alert('Error adding boy: ' + error.message);
        // Realtime will update the UI
    },

    async updateBoyStatus(index, action) {
        const boy = this.eventData.boys[index];
        const updates = {};

        // Match existing state logic
        if (action === 'IN') {
            updates.status = 'in';
            // Optimistic Update
            boy.status = 'in';
        } else if (action === 'DRESS') {
            if (boy.status === 'in') {
                updates.uniform_checked = true;
                // Optimistic Update
                boy.uniformChecked = true;
            }
        } else if (action === 'OUT') {
            updates.status = 'out';
            // Optimistic Update
            boy.status = 'out';
        } else if (action === 'RESET') {
            updates.status = 'pending';
            updates.uniform_checked = false;
            // Optimistic Update
            boy.status = 'pending';
            boy.uniformChecked = false;
        }

        if (Object.keys(updates).length > 0) {
            const { error } = await supabase.from('boys').update(updates).eq('id', boy.id);
            if (error) {
                console.error(error);
                // Revert? For now, assume success or reload will fix.
            }
        }
    },

    async toggleFine(index, type) {
        const boy = this.eventData.boys[index];
        const newFines = [...(boy.fines || [])];

        const fineIndex = newFines.indexOf(type);
        if (fineIndex > -1) {
            newFines.splice(fineIndex, 1);
        } else {
            newFines.push(type);
        }

        // Optimistic UI update
        boy.fines = newFines;

        const { error } = await supabase
            .from('boys')
            .update({ fines: newFines })
            .eq('id', boy.id);

        if (error) console.error("Error updating fines:", error);
    },

    openEditBoyModal(index) {
        this.editingBoyIndex = index;
        this.editingBoyData = { ...this.eventData.boys[index] };
        this.isEditBoyModalOpen = true;
    },

    async saveEditedBoy() {
        if (this.editingBoyIndex !== null) {
            const boyId = this.eventData.boys[this.editingBoyIndex].id;
            const updates = {
                name: this.editingBoyData.name,
                mobile: this.editingBoyData.mobile
            };

            const { error } = await supabase.from('boys').update(updates).eq('id', boyId);

            if (error) {
                alert("Failed to update boy");
                console.error(error);
            } else {
                this.isEditBoyModalOpen = false;
                this.editingBoyIndex = null;
            }
        }
    },

    async deleteBoy() {
        if (this.editingBoyIndex !== null) {
            const boyId = this.eventData.boys[this.editingBoyIndex].id;

            if (confirm("Are you sure you want to delete this boy?")) {
                const { error } = await supabase.from('boys').delete().eq('id', boyId);
                if (error) {
                    alert("Failed to delete");
                    console.error(error);
                } else {
                    this.isEditBoyModalOpen = false;
                    this.editingBoyIndex = null;
                }
            }
        }
    },

    // --- Parsing Logic ---

    async parseWhatsAppText() {
        let text = this.pastedText;
        if (!text) return;

        console.log("Parsing text...");

        // 1. Footer Removal
        const stopPhrases = ['❌❌❌', 'Interested boys mention names', 'READ THE DESCRIPTION'];
        for (const phrase of stopPhrases) {
            if (text.includes(phrase)) {
                text = text.split(phrase)[0];
            }
        }

        const lines = text.split('\n');

        // Regex patterns
        const dateRegex = /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})|(\d{1,2}\s+[A-Za-z]{3,}\s+\d{4})/;
        const mobileRegex = /(?:\+91[\-\s]?)?[6789]\d{4}[\-\s]?\d{5}|(?:\d{5}[\-\s]?\d{5})/;

        let extractedDate = '';
        let extractedTime = '';
        let extractedLocation = '';
        let extractedSchedule = '';
        let targetCount = null;

        let boysSectionStarted = false;

        // Check for BOYS header
        const boysHeaderMatch = lines.find(line => /BOYS\s*\(?\d+\)?/i.test(line));
        if (boysHeaderMatch) {
            const countMatch = boysHeaderMatch.match(/BOYS\s*\(?(\d+)\)?/i);
            if (countMatch) targetCount = parseInt(countMatch[1]);
        }

        const boysToInsert = [];

        lines.forEach(line => {
            let cleanLine = line.replace(/```/g, '').trim();
            if (!cleanLine) return;

            const lowerLine = cleanLine.toLowerCase();

            // Extract Metadata
            if (lowerLine.includes('date :') || lowerLine.startsWith('date')) {
                let datePart = cleanLine.split(':')[1];
                if (!datePart) datePart = cleanLine;
                extractedDate = datePart.replace(/\*/g, '').trim();
            }
            if (lowerLine.includes('report time') || lowerLine.includes('time :')) {
                extractedTime = cleanLine.replace(/.*(REPORT TIME|Time)\s*[:\-\s]\s*/i, '').replace(/\*/g, '').trim();
            }
            if (lowerLine.includes('location :') || lowerLine.includes('location')) {
                extractedLocation = cleanLine.replace(/.*Location\s*[:\-\s]\s*/i, '').replace(/\*/g, '').trim();
            }
            if (lowerLine.includes('schedule') || lowerLine.includes('shift')) {
                extractedSchedule = cleanLine.replace(/.*(Schedule|Shift)\s*[:\-\s]\s*/i, '').replace(/\*/g, '').trim();
            }

            // Boy Parsing
            if (/BOYS/i.test(cleanLine)) {
                boysSectionStarted = true;
                return;
            }

            if (boysSectionStarted) {
                // Check if line is a numbered list item
                const listMatch = cleanLine.match(/^(\d+)[\.\)]\s*(.*)/);
                if (listMatch) {
                    let content = listMatch[2].trim();
                    let mobile = '';

                    // Extract Mobile
                    const mobMatch = content.match(mobileRegex);
                    if (mobMatch) {
                        mobile = mobMatch[0].replace(/[\s\-]/g, '');
                        content = content.replace(mobileRegex, '').trim();
                    }

                    // Remove weird chars
                    let name = content.replace(/[\*\-]/g, '').trim();

                    // "1. Name" -> push to list
                    if (name.length > 2) { // Min length check
                        boysToInsert.push({ name, mobile });
                    }
                }
            }
        });

        // 2. Update Event Data in Supabase
        // Update local object first for Day calculation logic (if we want to keep it locally? Better to do it in event update)

        // Auto-calculate Day
        let day = this.eventData.day;
        if (extractedDate) {
            try {
                const d = new Date(extractedDate); // Basic test, might need the robust one from before if this fails often
                if (!isNaN(d.getTime())) day = d.toLocaleDateString('en-US', { weekday: 'long' });
            } catch (e) { }
        }

        // Update local state to show immediately? No, wait for realtime or confirm.
        // Update local state to show preview
        this.eventData.date = extractedDate || this.eventData.date;
        this.eventData.day = day;
        this.eventData.location = extractedLocation || this.eventData.location;
        this.eventData.reportTime = extractedTime || this.eventData.reportTime;
        this.eventData.schedule = extractedSchedule || this.eventData.schedule;
        if (targetCount) this.eventData.targetCount = targetCount;

        // Preview Boys (Local only)
        if (boysToInsert.length > 0) {
            this.eventData.boys = boysToInsert.map(b => ({
                name: b.name,
                mobile: b.mobile,
                status: 'pending' // Default status
            }));
        }

        this.isUnsaved = true; // Flag to show Save button
        this.isUpdateListModalOpen = false;
        this.pastedText = '';

        // Ensure we are in detail view to see the preview
        this.currentView = 'detail';
    },

    async saveEventToSupabase() {
        if (!this.eventData.location) {
            alert("No event data to save!");
            return;
        }

        // 1. Create/Update Event
        const payload = {
            date: this.eventData.date,
            day: this.eventData.day,
            location: this.eventData.location,
            schedule: this.eventData.schedule,
            target_count: this.eventData.targetCount,
            report_time: this.eventData.reportTime
        };

        let currentEventId = this.eventId;

        if (currentEventId) {
            await supabase.from('events').update(payload).eq('id', currentEventId);
        } else {
            const { data, error } = await supabase.from('events').insert([payload]).select();
            if (error) {
                alert("Error creating event: " + error.message);
                return;
            }
            if (data && data[0]) {
                currentEventId = data[0].id;
                this.eventId = currentEventId;
            }
        }

        // 2. Insert Boys
        if (this.eventData.boys.length > 0) {
            // Filter out boys that might already have IDs (if we are editing an existing event and adding more? 
            // For now, let's assume this flow is mostly for fresh pastes or re-pastes which might duplications if not careful.
            // Given the requirements, we'll process the current 'local' boys list.

            // Transform for DB
            const dbBoys = this.eventData.boys
                .filter(b => !b.id) // Only insert boys without ID (new ones)
                .map(b => ({
                    event_id: currentEventId,
                    name: b.name,
                    mobile: b.mobile,
                    status: b.status || 'pending'
                }));

            if (dbBoys.length > 0) {
                const { error } = await supabase.from('boys').insert(dbBoys);
                if (error) {
                    console.error("Error inserting boys:", error);
                    alert("Error adding boys to database");
                }
            }
        }

        alert("Event Saved & Published to Captains! ✅");
        this.isUnsaved = false;
        this.loadEventsList(); // Refresh dashboard list
    },

    // --- Report Generation ---

    generateWhatsAppReport() {
        const d = this.eventData;
        const total = d.boys.length;
        const present = this.presentCount;

        // Emojis
        const calendar = '📅';
        const clock = '⏰';
        const food = '🍽️';
        const pin = '📍';
        const check = '✅';
        const coat = '🧥';
        const flag = '🚩';

        let report = `📋 *MANPOWER ATTENDANCE REPORT*\n`;
        report += `${calendar} Date: ${d.date} (${d.day})\n`;
        report += `${clock} Time: ${d.reportTime}\n`;
        if (d.schedule) report += `${food} Schedule: ${d.schedule}\n`;
        if (d.location) report += `${pin} Location: ${d.location}\n\n`;

        report += `*BOYS LIST (${present}/${total})*\n`;

        d.boys.forEach((b, i) => {
            let icon = '';
            if (b.status === 'in') icon = check;
            else if (b.status === 'out') icon = flag;
            else icon = '⏳'; // Pending? Or just empty? User example shows marks.

            // Wait, user specific example:
            // 1. ✅ Rahul
            // 2. 🧥 Aman
            // 3. 🚩 Karthik

            // Logic:
            // If uniformChecked is true -> 🧥 (Overrides check?)
            // User example: "✅ Present: 10, 🧥 Dressed: 8".
            // If someone is Dressed, are they also Present? Yes.
            // Which icon to show in list? 
            // If uniformChecked -> 🧥. Else If In -> ✅. If Out -> 🚩.

            let statusIcon = '⏳'; // Default pending
            if (b.status === 'out') statusIcon = flag;
            else if (b.uniformChecked) statusIcon = coat;
            else if (b.status === 'in') statusIcon = check;

            // Fines
            let fineIcons = '';
            if (b.fines && b.fines.length > 0) {
                if (b.fines.includes('shoe')) fineIcons += ' 👞';
                if (b.fines.includes('pant')) fineIcons += ' 👖';
                if (b.fines.includes('late')) fineIcons += ' ⏰';
            }

            report += `${i + 1}. ${statusIcon} ${b.name}${fineIcons}\n`;
        });

        report += `\n*SUMMARY*\n`;
        report += `${check} Present: ${present}\n`;
        report += `${coat} Dressed: ${this.dressCount}\n`;
        report += `${flag} Out: ${this.outCount}\n`;
        report += `Total Strength: ${total}\n`;

        // Copy to clipboard
        navigator.clipboard.writeText(report).then(() => {
            alert('Report copied to clipboard!');
        }).catch(err => {
            console.error('Failed to copy: ', err);
        });

        // Open WhatsApp Share (optional, on mobile helps)
        const encoded = encodeURIComponent(report);
        // window.open(`https://wa.me/?text=${encoded}`, '_blank');
        return encoded;
    },

    shareReport() {
        const encodedReport = this.generateWhatsAppReport();
        window.open(`https://wa.me/?text=${encodedReport}`, '_blank');
        this.resetData(false); // No confirm needed when sharing
    },

    copyReport() {
        this.generateWhatsAppReport();
    },

    resetData(needConfirm = true) {
        if (!needConfirm || confirm('Are you sure you want to clear all data and start fresh?')) {
            localStorage.removeItem('manpowerData');
            location.reload();
        }
    },

    saveToStorage() {
        localStorage.setItem('manpowerData', JSON.stringify(this.eventData));
    }
}))

Alpine.start()
