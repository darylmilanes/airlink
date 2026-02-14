import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, 
    signInWithPopup, 
    GoogleAuthProvider, 
    signOut, 
    onAuthStateChanged,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, query, onSnapshot, enableIndexedDbPersistence, orderBy } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

/** CONFIGURATION */
const CONFIG = {
    firebase: {
        apiKey: "AIzaSyChp_DuOcvNw6k809mjwG-o1EqiBWo8x2A",
        authDomain: "airlink-754f2.firebaseapp.com",
        projectId: "airlink-754f2",
        storageBucket: "airlink-754f2.firebasestorage.app",
        messagingSenderId: "410579374648",
        appId: "1:410579374648:web:1f153598f4ab66ab77cccd"
    },
    months: ["January","February","March","April","May","June","July","August","September","October","November","December"]
};

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
}

/** HOLIDAY LOGIC */
class HolidayManager {
    static getHolidays(year) {
        const fixed = [
            { m: 0, d: 1, name: "New Year's Day" },
            { m: 3, d: 9, name: "Araw ng Kagitingan" },
            { m: 4, d: 1, name: "Labor Day" },
            { m: 5, d: 12, name: "Independence Day" },
            { m: 7, d: 21, name: "Ninoy Aquino Day" },
            { m: 10, d: 1, name: "All Saints' Day" },
            { m: 10, d: 30, name: "Bonifacio Day" },
            { m: 11, d: 8, name: "Immaculate Conception" },
            { m: 11, d: 25, name: "Christmas Day" },
            { m: 11, d: 30, name: "Rizal Day" }
        ];
        // Heroes Day: Last Mon Aug
        let d = new Date(year, 7, 31);
        while(d.getDay()!==1) d.setDate(d.getDate()-1);
        fixed.push({m:7, d:d.getDate(), name:"National Heroes Day"});
        return fixed;
    }
    static getForDate(d) {
        return this.getHolidays(d.getFullYear()).find(h => h.m === d.getMonth() && h.d === d.getDate());
    }
}

/** UI & UTILS */
class UIManager {
    constructor() {
        this.toastEl = document.getElementById('toast');
        this.toastMsg = document.getElementById('toast-msg');
        this.toastIcon = document.getElementById('toast-icon');
        
        this.initConfirm();
    }

    showToast(msg, icon="ph-check-circle") {
        this.toastMsg.textContent = msg;
        this.toastIcon.className = `ph-bold ${icon}`;
        this.toastEl.classList.add('visible');
        setTimeout(() => this.toastEl.classList.remove('visible'), 1500); // Faster 1.5s
    }

    initConfirm() {
        const modal = document.getElementById('confirm-modal');
        
        const close = () => {
            modal.classList.remove('active');
        };

        document.getElementById('confirm-cancel').onclick = close;
        
        document.getElementById('confirm-ok').onclick = () => {
            close();
            if (this.confirmCallback) this.confirmCallback();
        };

        this.showConfirm = (title, text, cb) => {
            document.getElementById('confirm-title').textContent = title;
            document.getElementById('confirm-text').textContent = text;
            this.confirmCallback = cb;
            modal.classList.add('active');
        };
    }

    // New Card Generator
    createEventCard(evt, onClick) {
        const isDone = evt.status === 'done';
        const card = document.createElement('div');
        card.className = `event-card ${isDone ? 'done' : ''}`;
        
        let barColor = 'var(--text-secondary)';
        let icon = '';
        let metaHtml = '';

        // Distinction Logic
        if (evt.type === 'payment') {
            barColor = 'var(--danger)';
            // Recurrence Text
            let rText = '';
            if (evt.recurrenceRule) {
                const r = evt.recurrenceRule;
                if(r.freq === 'weekly') rText = 'Weekly';
                else if(r.freq === 'monthly') rText = `Monthly (Day ${r.day || 1})`;
                else if(r.freq === 'yearly') rText = 'Yearly';
                else if(r.freq === 'others') rText = `Every ${r.interval} days`;
            }
            if(rText) metaHtml = `<i class="ph-bold ph-arrows-clockwise"></i> ${rText}`;
        } else if (evt.type === 'todo') {
            barColor = evt.priority === 'high' ? 'var(--danger)' : evt.priority === 'medium' ? 'var(--warning)' : 'var(--success)';
            metaHtml = `<span style="width:8px;height:8px;border-radius:50%;background:${barColor};display:inline-block;"></span> Priority: ${evt.priority || 'Low'}`;
        } else if (evt.type === 'event') {
            barColor = 'var(--blue)';
            if (evt.location) metaHtml = `<i class="ph-bold ph-map-pin"></i> ${evt.location}`;
        }

        const [h, m] = evt.time.split(':');
        const hour = parseInt(h);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const hour12 = hour % 12 || 12;

        card.innerHTML = `
            <div class="type-indicator" style="background:${barColor}"></div>
            <div class="time-col">
                <span class="time-text">${hour12}:${m}</span>
                <span class="time-ampm">${ampm}</span>
            </div>
            <div class="info-col">
                <div class="event-title">${evt.title}</div>
                ${metaHtml ? `<div class="event-meta">${metaHtml}</div>` : ''}
            </div>
        `;
        
        card.onclick = onClick;
        return card;
    }

    getOrdinal(n) {
        const s = ["th","st","nd","rd"], v = n%100;
        return n + (s[(v-20)%10] || s[v] || s[0]);
    }
}

/** MAIN APP */
class App {
    constructor() {
        this.app = null; this.auth = null; this.db = null; this.user = null;
        this.events = []; // Raw DB events
        this.viewDate = new Date();
        this.selectedDate = new Date();
        this.ui = new UIManager();
        
        this.initFirebase();
        this.initDOM();
    }

    initFirebase() {
        try {
            this.app = initializeApp(CONFIG.firebase);
            this.auth = getAuth(this.app);
            this.db = getFirestore(this.app);
            enableIndexedDbPersistence(this.db).catch(() => {});
            onAuthStateChanged(this.auth, (u) => this.handleAuth(u));
        } catch(e) { console.error(e); }
    }

    handleAuth(user) {
        this.user = user;
        const landing = document.getElementById('auth-landing');
        const main = document.getElementById('main-app-wrapper');
        const loader = document.getElementById('loading-overlay');
        
        // Hide Loader
        loader.classList.add('fade-out');

        if (user) {
            landing.classList.add('hidden');
            main.classList.remove('hidden');
            document.getElementById('user-email-display').textContent = user.email;
            
            // Listen to ALL user events (we filter in memory for recurrence)
            const q = query(collection(this.db, `artifacts/${CONFIG.firebase.appId}/users/${user.uid}/events`));
            onSnapshot(q, (snap) => {
                this.events = snap.docs.map(d => ({id:d.id, ...d.data()}));
                this.render();
            });
            this.ui.showToast("Signed In");
        } else {
            // Force Close Modals on Sign Out
            document.getElementById('modal').classList.remove('active');
            document.getElementById('settings-dropdown').classList.add('hidden');
            document.getElementById('confirm-modal').classList.remove('active');
            
            landing.classList.remove('hidden');
            main.classList.add('hidden');
            this.events = [];
        }
    }

    initDOM() {
        // --- Settings Menu & Global Click Handler ---
        const setBtn = document.getElementById('settings-btn');
        const setDrop = document.getElementById('settings-dropdown');
        const fab = document.getElementById('fab-container');
        
        setBtn.onclick = (e) => { e.stopPropagation(); setDrop.classList.toggle('hidden'); };
        
        // FIX: Ensure clicking background closes BOTH Settings and FAB
        document.body.onclick = () => {
            setDrop.classList.add('hidden');
            fab.classList.remove('open');
        };

        // Prevent closing when clicking INSIDE these
        document.getElementById('settings-dropdown').onclick = (e) => e.stopPropagation();
        
        document.getElementById('logout-btn').onclick = () => {
            setDrop.classList.add('hidden');
            this.ui.showConfirm("Sign Out", "Are you sure?", () => signOut(this.auth));
        };

        // --- Today Button ---
        document.getElementById('today-btn').onclick = () => {
            this.viewDate = new Date();
            this.selectedDate = new Date();
            this.render();
        };

        // --- Navigation ---
        document.getElementById('prev-month').onclick = () => { this.viewDate.setMonth(this.viewDate.getMonth()-1); this.render(); };
        document.getElementById('next-month').onclick = () => { this.viewDate.setMonth(this.viewDate.getMonth()+1); this.render(); };

        // --- FAB & Modals ---
        document.getElementById('fab-main').onclick = (e) => { e.stopPropagation(); fab.classList.toggle('open'); };
        
        ['payment','todo','event'].forEach(type => {
            document.querySelector(`.btn-${type}`).onclick = (e) => {
                e.stopPropagation(); 
                fab.classList.remove('open');
                this.openModal(type);
            };
        });

        // --- Recurrence UI Logic (Chips & Sub-options) ---
        const freqChips = document.querySelectorAll('#freq-chips .chip');
        freqChips.forEach(chip => {
            chip.onclick = () => {
                freqChips.forEach(c => c.classList.remove('selected'));
                chip.classList.add('selected');
                
                const val = chip.dataset.val;
                document.getElementById('inp-freq-main').value = val;
                
                // Toggle sub-sections
                document.querySelectorAll('.sub-group').forEach(el => el.classList.add('hidden'));
                if (val === 'weekly') document.getElementById('sub-weekly').classList.remove('hidden');
                if (val === 'monthly') document.getElementById('sub-monthly').classList.remove('hidden');
                if (val === 'others') document.getElementById('sub-others').classList.remove('hidden');
            };
        });

        // Weekly Day Circles
        const dayCircles = document.querySelectorAll('.day-circle');
        dayCircles.forEach(btn => {
            btn.onclick = () => {
                dayCircles.forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                document.getElementById('inp-freq-weekly-day').value = btn.dataset.d;
            };
        });

        // Monthly Wheel Logic (New)
        const wheelContainer = document.getElementById('month-wheel-container');
        for (let i = 1; i <= 31; i++) {
            const el = document.createElement('div');
            el.className = 'wheel-item';
            el.textContent = i;
            el.dataset.val = i;
            el.onclick = () => {
                document.querySelectorAll('.wheel-item').forEach(w => w.classList.remove('selected'));
                el.classList.add('selected');
                document.getElementById('inp-freq-monthly-date').value = i;
            };
            wheelContainer.appendChild(el);
        }

        // Priority Chips
        const prioChips = document.querySelectorAll('#priority-chips .chip');
        prioChips.forEach(chip => {
            chip.onclick = () => {
                prioChips.forEach(c => c.classList.remove('selected'));
                chip.classList.add('selected');
                document.getElementById('inp-priority').value = chip.dataset.val;
            };
        });

        // Auth Toggles
        document.getElementById('btn-show-register').onclick = () => this.switchAuth('register-form');
        document.getElementById('btn-show-login').onclick = () => this.switchAuth('login-form');
        document.getElementById('btn-forgot-pass').onclick = () => this.switchAuth('forgot-form');
        document.getElementById('btn-back-login').onclick = () => this.switchAuth('login-form');
        
        // Pass Toggles
        document.querySelectorAll('.toggle-pass').forEach(btn => {
            btn.onclick = () => {
                const inp = document.getElementById(btn.dataset.target);
                const i = btn.querySelector('i');
                if(inp.type==='password') { inp.type='text'; i.classList.replace('ph-eye','ph-eye-slash'); }
                else { inp.type='password'; i.classList.replace('ph-eye-slash','ph-eye'); }
            };
        });

        // Auth Submits - GENERIC ERRORS
        document.getElementById('login-form').onsubmit = (e) => { 
            e.preventDefault(); 
            signInWithEmailAndPassword(this.auth, document.getElementById('login-email').value, document.getElementById('login-pass').value)
                .catch(err => this.ui.showToast("Invalid email or password.", "ph-warning")); 
        };
        document.getElementById('register-form').onsubmit = (e) => { 
            e.preventDefault(); 
            createUserWithEmailAndPassword(this.auth, document.getElementById('reg-email').value, document.getElementById('reg-pass').value)
                .catch(err => this.ui.showToast("Could not create account.", "ph-warning")); 
        };
        document.getElementById('btn-google-login').onclick = () => signInWithPopup(this.auth, new GoogleAuthProvider()).catch(() => this.ui.showToast("Login cancelled or failed.", "ph-warning"));
        
        // Modal Submit
        document.getElementById('event-form').onsubmit = (e) => this.handleSave(e);
        
        // Expose
        window.attemptCloseModal = () => document.getElementById('modal').classList.remove('active');
    }

    switchAuth(id) {
        document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
        document.getElementById(id).classList.add('active');
    }

    // --- LOGIC ---

    openModal(type, existing = null) {
        const modal = document.getElementById('modal');
        const form = document.getElementById('event-form');
        form.reset();
        
        // Setup Type UI
        document.getElementById('inp-type').value = existing ? existing.type : type;
        const actualType = existing ? existing.type : type;

        document.getElementById('modal-title').textContent = existing ? "Edit Item" : (actualType === 'payment' ? "New Payment" : actualType === 'todo' ? "New To Do" : "New Event");
        
        // Hide all sections first
        document.querySelectorAll('.hidden-section').forEach(el => el.style.display = 'none');
        
        // Show specific sections
        if (actualType === 'payment') document.getElementById('section-payment-options').style.display = 'block';
        if (actualType === 'event') document.getElementById('section-event-details').style.display = 'block';
        if (actualType === 'todo') document.getElementById('section-todo-details').style.display = 'block';

        // Populate Fields
        document.getElementById('inp-id').value = existing ? existing.id : '';
        document.getElementById('inp-title').value = existing ? existing.title : '';
        document.getElementById('inp-time').value = existing ? existing.time : '09:00'; // Default time
        document.getElementById('inp-desc').value = existing ? existing.desc : '';

        // Type Specific Population
        if (actualType === 'event' && existing) document.getElementById('inp-location').value = existing.location || '';
        
        // Priority Pop
        if (actualType === 'todo') {
            const p = existing ? existing.priority : 'medium';
            document.getElementById('inp-priority').value = p;
            document.querySelectorAll('#priority-chips .chip').forEach(c => {
                if(c.dataset.val === p) c.classList.add('selected');
                else c.classList.remove('selected');
            });
        }

        // Recurrence Pop
        if (actualType === 'payment') {
            const rule = existing && existing.recurrenceRule ? existing.recurrenceRule : { freq: 'one-time' };
            const freq = rule.freq;
            
            // Select Main Chip
            document.getElementById('inp-freq-main').value = freq;
            document.querySelectorAll('#freq-chips .chip').forEach(c => {
                if(c.dataset.val === freq) { c.classList.add('selected'); c.click(); } // Click triggers UI update
                else c.classList.remove('selected');
            });

            // Populate Sub-values
            if (freq === 'weekly' && rule.day !== undefined) {
                document.querySelectorAll('.day-circle')[rule.day].click();
            }
            if (freq === 'monthly' && rule.day) {
                // Select wheel item
                document.querySelectorAll('.wheel-item').forEach(w => {
                    if (parseInt(w.dataset.val) === rule.day) {
                         w.classList.add('selected');
                         w.scrollIntoView({ block: "center" });
                         document.getElementById('inp-freq-monthly-date').value = rule.day;
                    } else w.classList.remove('selected');
                });
            }
            if (freq === 'others' && rule.interval) {
                document.getElementById('inp-other-interval').value = rule.interval;
            }
        }

        // Edit Mode Buttons
        const actions = document.getElementById('modal-actions');
        const statusBtn = document.getElementById('btn-toggle-status');
        const delBtn = document.getElementById('btn-delete-entry');
        
        if (existing) {
            actions.classList.add('edit-mode');
            statusBtn.onclick = async () => {
                modal.classList.remove('active');
                await updateDoc(doc(this.db, `artifacts/${CONFIG.firebase.appId}/users/${this.user.uid}/events`, existing.id), { status: existing.status==='done'?'active':'done' });
            };
            delBtn.onclick = () => {
                this.ui.showConfirm("Delete Item", "This cannot be undone.", async () => {
                    modal.classList.remove('active');
                    await deleteDoc(doc(this.db, `artifacts/${CONFIG.firebase.appId}/users/${this.user.uid}/events`, existing.id));
                    this.ui.showToast("Deleted", "ph-trash");
                });
            };
        } else {
            actions.classList.remove('edit-mode');
        }

        modal.classList.add('active');
    }

    async handleSave(e) {
        e.preventDefault();
        const type = document.getElementById('inp-type').value;
        
        // Base Data
        const data = {
            type: type,
            title: document.getElementById('inp-title').value,
            time: document.getElementById('inp-time').value,
            desc: document.getElementById('inp-desc').value,
            status: 'active',
            dateKey: this.formatDate(this.selectedDate) // Initial date
        };

        // Extra Fields
        if (type === 'event') {
            data.location = document.getElementById('inp-location').value;
        } else if (type === 'todo') {
            data.priority = document.getElementById('inp-priority').value;
        } else if (type === 'payment') {
            const freq = document.getElementById('inp-freq-main').value;
            const rule = { freq };
            
            if (freq === 'weekly') rule.day = parseInt(document.getElementById('inp-freq-weekly-day').value || 0);
            if (freq === 'monthly') rule.day = parseInt(document.getElementById('inp-freq-monthly-date').value);
            if (freq === 'others') rule.interval = parseInt(document.getElementById('inp-other-interval').value);
            
            data.recurrenceRule = rule;
        }

        const id = document.getElementById('inp-id').value;
        document.getElementById('modal').classList.remove('active');
        this.ui.showToast(id ? "Changes Saved" : "Item Added");

        const col = `artifacts/${CONFIG.firebase.appId}/users/${this.user.uid}/events`;
        if (id) await updateDoc(doc(this.db, col, id), data);
        else {
            data.createdAt = new Date().toISOString();
            await addDoc(collection(this.db, col), data);
        }
    }

    // --- CORE RENDER LOGIC ---

    render() {
        if (!this.user) return;
        
        // Header
        document.getElementById('month-display').textContent = 
            `${CONFIG.months[this.viewDate.getMonth()]} ${this.viewDate.getFullYear()}`;
        
        const grid = document.getElementById('days-grid');
        grid.innerHTML = '';
        
        const y = this.viewDate.getFullYear();
        const m = this.viewDate.getMonth();
        const daysInMonth = new Date(y, m+1, 0).getDate();
        const firstDay = new Date(y, m, 1).getDay();
        const holidays = HolidayManager.getHolidays(y);

        // Padding
        for(let i=0; i<firstDay; i++) {
            const d = document.createElement('div');
            d.className = 'day other-month';
            grid.appendChild(d);
        }

        // Days
        for(let i=1; i<=daysInMonth; i++) {
            const d = document.createElement('div');
            d.className = 'day';
            d.textContent = i;
            
            const currentLoopDate = new Date(y, m, i);
            const key = this.formatDate(currentLoopDate);

            // Today / Selected Check
            const now = new Date();
            if (currentLoopDate.toDateString() === now.toDateString()) d.classList.add('today');
            if (currentLoopDate.toDateString() === this.selectedDate.toDateString()) d.classList.add('selected');

            // --- DOTS LOGIC (Includes Recurrence) ---
            const dots = document.createElement('div');
            dots.className = 'dots-container';
            
            // 1. Holiday Dot
            if (holidays.find(h => h.m === m && h.d === i)) {
                const dot = document.createElement('div'); dot.className = 'dot'; dot.style.background = 'var(--holiday)';
                dots.appendChild(dot);
            }

            // 2. Events Check (The heavy lifting)
            // Get events for THIS specific day
            const dailyEvents = this.getEventsForDate(currentLoopDate);
            
            dailyEvents.slice(0, 3).forEach(evt => {
                const dot = document.createElement('div');
                dot.className = 'dot';
                if(evt.type==='payment') dot.style.background = 'var(--danger)';
                else if(evt.type==='todo') dot.style.background = 'var(--success)';
                else dot.style.background = 'var(--blue)';
                dots.appendChild(dot);
            });

            d.appendChild(dots);
            d.onclick = () => { this.selectedDate = currentLoopDate; this.render(); };
            grid.appendChild(d);
        }

        this.renderList();
    }

    getEventsForDate(date) {
        const key = this.formatDate(date);
        const dayOfWeek = date.getDay();
        const dayOfMonth = date.getDate();
        const month = date.getMonth();
        const year = date.getFullYear();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        return this.events.filter(e => {
            if (e.status === 'done') return false; // Optional: hide done from calendar dots?
            
            // 1. Exact Match
            if (e.dateKey === key) return true;

            // 2. Recurrence Logic (Only for Payments currently)
            if (e.type === 'payment' && e.recurrenceRule) {
                const r = e.recurrenceRule;
                const start = new Date(e.dateKey);
                if (date < start) return false; // Hasn't started yet

                if (r.freq === 'weekly') {
                    return dayOfWeek === (r.day !== undefined ? r.day : start.getDay());
                }
                
                if (r.freq === 'monthly') {
                    const targetDay = r.day || start.getDate();
                    // SMART FEB LOGIC:
                    // If target is 30, and month only has 28 days, show on 28th.
                    // Logic: If current day IS the last day of month, AND target >= current day
                    const isLastDay = dayOfMonth === daysInMonth;
                    if (isLastDay && targetDay >= dayOfMonth) return true;
                    return dayOfMonth === targetDay;
                }

                if (r.freq === 'yearly') {
                    return dayOfMonth === start.getDate() && month === start.getMonth();
                }

                if (r.freq === 'others' && r.interval) {
                    const diffTime = Math.abs(date - start);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
                    return diffDays % r.interval === 0;
                }
            }
            return false;
        });
    }

    renderList() {
        const container = document.getElementById('events-list');
        container.innerHTML = '';
        
        document.getElementById('selected-date-label').textContent = 
            this.selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

        const holiday = HolidayManager.getForDate(this.selectedDate);
        if (holiday) {
            const hDiv = document.createElement('div');
            hDiv.className = 'event-card';
            hDiv.innerHTML = `<div class="type-indicator" style="background:var(--holiday)"></div><div class="info-col"><div class="event-title">${holiday.name}</div><div class="event-meta">Holiday</div></div>`;
            container.appendChild(hDiv);
        }

        const events = this.getEventsForDate(this.selectedDate);
        
        if (events.length === 0 && !holiday) {
            container.innerHTML = `<div style="text-align:center; padding:40px; color:var(--text-secondary); opacity:0.6;">No items for this day</div>`;
            return;
        }

        // Sort: Time
        events.sort((a,b) => a.time.localeCompare(b.time));

        events.forEach(evt => {
            const card = this.ui.createEventCard(evt, () => this.openModal(evt.type, evt));
            container.appendChild(card);
        });
    }

    formatDate(d) {
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }
}

new App();
