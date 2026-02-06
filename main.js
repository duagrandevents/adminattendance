import Alpine from 'alpinejs'
import './style.css'
import { supabase } from './supabaseClient'

window.Alpine = Alpine

Alpine.data('manpowerApp', () => ({
    // Mostly identical to Captain but with Delete Event
    currentView: 'list',
    eventsList: [],

    eventId: null,
    eventData: { date: '', day: '', location: '', schedule: '', reportTime: '', targetCount: 15, boys: [] },

    showActionSheet: false,
    isUpdateListModalOpen: false,
    expandedRow: null,
    showFineMenu: null,
    pastedText: '',

    async init() {
        console.log("Admin v3.0");
        await this.loadEventsList();

        supabase.channel('public:events').on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => {
            this.loadEventsList();
        }).subscribe();
    },

    async loadEventsList() {
        const { data } = await supabase.from('events').select('*').order('created_at', { ascending: false });
        this.eventsList = data || [];
    },

    async selectEvent(event) {
        this.eventId = event.id;
        this.eventData = { ...event, boys: [] };
        this.currentView = 'detail';
        await this.loadBoys();
    },

    backToDashboard() { this.currentView = 'list'; this.eventId = null; },
    openCreateEvent() { this.eventId = null; this.resetData(); this.currentView = 'detail'; this.isUpdateListModalOpen = true; },
    resetData() { this.eventData = { date: '', day: '', location: '', schedule: '', reportTime: '', targetCount: 15, boys: [] }; },

    async loadBoys() {
        if (!this.eventId) return;
        const { data } = await supabase.from('boys').select('*').eq('event_id', this.eventId).order('roll_no', { ascending: true });
        this.eventData.boys = (data || []).map(b => ({ id: b.id, rollNo: b.roll_no, name: b.name, mobile: b.mobile, status: b.status, uniformChecked: b.uniform_checked, fines: b.fines || [] }));
    },

    // --- Admin Action: Delete Event ---
    async deleteEvent(id) {
        if (confirm("Delete this site?")) {
            await supabase.from('boys').delete().eq('event_id', id);
            await supabase.from('events').delete().eq('id', id);
            await this.loadEventsList();
        }
    },

    // --- Actions ---
    toggleRowAction(i) { this.expandedRow = this.expandedRow === i ? null : i; this.showFineMenu = null; },
    toggleFineMenu(i) { this.showFineMenu = this.showFineMenu === i ? null : i; },

    async updateStatus(index, action) {
        const boy = this.eventData.boys[index];
        const updates = {};
        if (action === 'in') { boy.status = 'in'; updates.status = 'in'; }
        else if (action === 'dress') { boy.uniformChecked = true; updates.uniform_checked = true; }
        else if (action === 'out') { boy.status = 'out'; updates.status = 'out'; }
        else if (action === 'reset') { boy.status = 'pending'; boy.uniformChecked = false; boy.fines = []; updates.status = 'pending'; updates.uniform_checked = false; updates.fines = []; }

        if (this.eventId && boy.id) await supabase.from('boys').update(updates).eq('id', boy.id);
    },

    async toggleFine(index, type) {
        const boy = this.eventData.boys[index];
        if (!boy.fines) boy.fines = [];
        const idx = boy.fines.indexOf(type);
        if (idx > -1) boy.fines.splice(idx, 1);
        else boy.fines.push(type);
        if (this.eventId && boy.id) await supabase.from('boys').update({ fines: boy.fines }).eq('id', boy.id);
    },

    // --- Parser & Saver (Identical to Captain) ---
    async parseWhatsAppText() {
        if (!this.pastedText) return;
        let text = this.pastedText;
        ['❌', 'Interested boys', 'READ THE DESCRIPTION'].forEach(p => { if (text.includes(p)) text = text.split(p)[0]; });

        const d = text.match(/(?:DATE|Date)\s*[:\-]?\s*\*?([0-9\/]+)\*?/); if (d) this.eventData.date = d[1].trim();
        const l = text.match(/(?:LOCATION|Location)\s*[:\-]?\s*\*?([A-Za-z\s]+)\*?/); if (l) this.eventData.location = l[1].trim();

        const boys = [];
        text.split('\n').forEach(line => {
            const m = line.replace(/```/g, '').trim().match(/^(\d+)[\.\)]\s*(.*)/);
            if (m) {
                let name = m[2].replace(/(?:\+91[\-\s]?)?[6789]\d{9}/, '').replace(/[\*\-]/g, '').trim();
                if (name.length > 2) boys.push({ rollNo: parseInt(m[1]), name, mobile: '' });
            }
        });

        this.eventData.boys = boys.map(n => {
            const ex = this.eventData.boys.find(b => b.name.toLowerCase() === n.name.toLowerCase());
            return { rollNo: n.rollNo, name: n.name, mobile: ex ? ex.mobile : '', status: ex ? ex.status : 'pending', uniformChecked: ex ? ex.uniformChecked : false, fines: ex ? ex.fines : [] };
        });
        this.isUpdateListModalOpen = false;
        alert("Parsed! Click Save to publish.");
    },

    async saveEventToSupabase() {
        if (!this.eventData.location) return alert("Needs Location");
        const payload = { date: this.eventData.date, location: this.eventData.location, schedule: this.eventData.schedule, report_time: this.eventData.reportTime, target_count: this.eventData.targetCount };

        let cid = this.eventId;
        if (cid) await supabase.from('events').update(payload).eq('id', cid);
        else { const { data } = await supabase.from('events').insert([payload]).select(); cid = data[0].id; this.eventId = cid; }

        await supabase.from('boys').delete().eq('event_id', cid);
        for (const b of this.eventData.boys) {
            await new Promise(r => setTimeout(r, 20));
            await supabase.from('boys').insert([{ event_id: cid, roll_no: b.rollNo, name: b.name, status: b.status, uniform_checked: b.uniformChecked, fines: b.fines }]);
        }
        alert("Saved & Synced! ✅");
        await this.loadBoys();
    },

    // Report
    generateReport() {
        return this.eventData.boys.map(b => `${b.rollNo}. ${b.status === 'out' ? '🚩' : (b.uniformChecked ? '🧥' : (b.status === 'in' ? '✅' : '⏳'))} ${b.name}`).join('\n');
    },
    shareReport() {
        window.open(`https://wa.me/?text=${encodeURIComponent(this.eventData.location + '\n' + this.generateReport())}`, '_blank');
    },

    get presentCount() { return this.eventData.boys.filter(b => b.status !== 'pending').length; },
    get dressCount() { return this.eventData.boys.filter(b => b.uniformChecked).length; },
    get outCount() { return this.eventData.boys.filter(b => b.status === 'out').length; }
}))

Alpine.start()
