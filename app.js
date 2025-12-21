import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, query, onSnapshot, enableIndexedDbPersistence, orderBy } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

/* --- SERVICE WORKER REGISTRATION (PWA) --- */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js')
            .then(reg => console.log('Service Worker registered', reg))
            .catch(err => console.error('Service Worker registration failed', err));
    });
}

/* --- FIREBASE CONFIG & INIT --- */
const firebaseConfig = {
    apiKey: "AIzaSyChp_DuOcvNw6k809mjwG-o1EqiBWo8x2A",
    authDomain: "airlink-754f2.firebaseapp.com",
    projectId: "airlink-754f2",
    storageBucket: "airlink-754f2.firebasestorage.app",
    messagingSenderId: "410579374648",
    appId: "1:410579374648:web:1f153598f4ab66ab77cccd"
};

let app, auth, db;
try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    enableIndexedDbPersistence(db).catch(e=>{});
} catch(e) {}

let events = [];
let viewDate = new Date();
let selectedDate = new Date();
let currentUser = null;
let unsubscribe = null;

/* --- HOLIDAY LOGIC --- */
function getHolidays(year) {
    const fixed = [
        { m: 0, d: 1, name: "New Year's Day" },
        { m: 3, d: 9, name: "Araw ng Kagitingan" },
        { m: 4, d: 1, name: "Labor Day" },
        { m: 5, d: 12, name: "Independence Day" },
        { m: 10, d: 30, name: "Bonifacio Day" },
        { m: 11, d: 25, name: "Christmas Day" },
        { m: 11, d: 30, name: "Rizal Day" },
        // Special Non-Working
        { m: 1, d: 25, name: "EDSA Revolution" },
        { m: 7, d: 21, name: "Ninoy Aquino Day" },
        { m: 10, d: 1, name: "All Saints' Day" },
        { m: 11, d: 8, name: "Immaculate Conception" },
        { m: 11, d: 31, name: "Last Day of the Year" },
        // Additional Special
        { m: 10, d: 2, name: "All Souls' Day" },
        { m: 11, d: 24, name: "Christmas Eve" }
    ];

    // National Heroes Day: Last Monday of August
    let augLastMon = new Date(year, 7, 31);
    while (augLastMon.getDay() !== 1) augLastMon.setDate(augLastMon.getDate() - 1);
    fixed.push({ m: 7, d: augLastMon.getDate(), name: "National Heroes Day" });

    // Easter Calculation
    const f = Math.floor, y = year;
    const G = y % 19;
    const C = f(y / 100);
    const H = (C - f(C / 4) - f((8 * C + 13) / 25) + 19 * G + 15) % 30;
    const I = H - f(H / 28) * (1 - f(29 / (H + 1)) * f((21 - G) / 11));
    const J = (y + f(y / 4) + I + 2 - C + f(C / 4)) % 7;
    const L = I - J;
    const month = 3 + f((L + 40) / 44);
    const day = L + 28 - 31 * f(month / 4);
    
    const easter = new Date(year, month - 1, day);
    const maundy = new Date(easter); maundy.setDate(easter.getDate() - 3);
    const goodFri = new Date(easter); goodFri.setDate(easter.getDate() - 2);
    const blackSat = new Date(easter); blackSat.setDate(easter.getDate() - 1);

    fixed.push({ m: maundy.getMonth(), d: maundy.getDate(), name: "Maundy Thursday" });
    fixed.push({ m: goodFri.getMonth(), d: goodFri.getDate(), name: "Good Friday" });
    fixed.push({ m: blackSat.getMonth(), d: blackSat.getDate(), name: "Black Saturday" });

    return fixed;
}

function getHolidayForDate(d) {
    const hols = getHolidays(d.getFullYear());
    return hols.find(h => h.m === d.getMonth() && h.d === d.getDate());
}

/* --- UI UTILS --- */
function showToast(msg, icon="ph-check-circle") {
    const el = document.getElementById('toast');
    document.getElementById('toast-msg').textContent = msg;
    document.getElementById('toast-icon').className = `ph-bold ${icon}`;
    el.classList.add('visible');
    setTimeout(() => el.classList.remove('visible'), 1500);
}

let confirmCallback = null;
const confirmModal = document.getElementById('confirm-modal');
document.getElementById('confirm-cancel').onclick = () => confirmModal.classList.remove('active');
document.getElementById('confirm-ok').onclick = () => {
    confirmModal.classList.remove('active');
    if(confirmCallback) confirmCallback();
};

function showConfirm(title, text, onConfirm) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-text').textContent = text;
    confirmCallback = onConfirm;
    confirmModal.classList.add('active');
}

/* --- AUTH --- */
const authBtn = document.getElementById('auth-btn');
authBtn.onclick = () => {
    if(!currentUser) signInWithPopup(auth, new GoogleAuthProvider());
    else showConfirm("Sign Out", "Are you sure you want to sign out?", () => {
        signOut(auth);
        showToast("Signed Out", "ph-sign-out");
    });
};

onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if(user) {
        authBtn.textContent = "Sign Out";
        const q = query(collection(db, `artifacts/${firebaseConfig.appId}/users/${user.uid}/events`), orderBy('dateKey'));
        unsubscribe = onSnapshot(q, (snap) => {
            events = snap.docs.map(d => ({id:d.id, ...d.data()}));
            render();
        });
        showToast("Signed In");
    } else {
        authBtn.textContent = "Sign In";
        events = [];
        if(unsubscribe) unsubscribe();
        render();
    }
});

/* --- RENDERING --- */
function render() {
    const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    document.getElementById('month-display').textContent = `${months[viewDate.getMonth()]} ${viewDate.getFullYear()}`;

    const grid = document.getElementById('days-grid');
    grid.innerHTML = "";
    const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();
    const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
    const prevMonthLast = new Date(viewDate.getFullYear(), viewDate.getMonth(), 0).getDate();

    const yearHols = getHolidays(viewDate.getFullYear());

    for(let i=0; i<firstDay; i++) {
        grid.innerHTML += `<div class="day other-month">${prevMonthLast - firstDay + 1 + i}</div>`;
    }

    for(let i=1; i<=daysInMonth; i++) {
        const d = document.createElement('div');
        d.className = 'day';
        d.textContent = i;
        
        const thisDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), i);
        const key = formatDate(thisDate);
        const isHoliday = yearHols.find(h => h.m === thisDate.getMonth() && h.d === thisDate.getDate());

        if(thisDate.toDateString() === new Date().toDateString()) d.classList.add('today');
        if(thisDate.toDateString() === selectedDate.toDateString()) d.classList.add('selected');

        const dots = document.createElement('div');
        dots.className = 'dots-container';

        if(isHoliday) {
            const hDot = document.createElement('div');
            hDot.className = 'dot';
            hDot.style.background = 'var(--holiday)';
            dots.appendChild(hDot);
        }

        const dayEvts = events.filter(e => e.dateKey === key && e.status !== 'done');
        if(dayEvts.length > 0) {
            dayEvts.slice(0,2).forEach(evt => {
                const dot = document.createElement('div');
                dot.className = 'dot';
                if(evt.type==='payment') dot.style.background='var(--danger)';
                else if(evt.type==='todo') dot.style.background='var(--success)';
                else dot.style.background='var(--warning)';
                dots.appendChild(dot);
            });
        }
        
        if(dots.children.length > 0) d.appendChild(dots);

        d.onclick = () => { selectedDate = thisDate; render(); };
        grid.appendChild(d);
    }
    renderList();
}

function renderList() {
    const list = document.getElementById('events-list');
    list.innerHTML = "";
    document.getElementById('selected-date-label').textContent = selectedDate.toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric'});
    
    const key = formatDate(selectedDate);
    
    const holiday = getHolidayForDate(selectedDate);
    if(holiday) {
        const holCard = document.createElement('div');
        holCard.className = 'event-card holiday';
        holCard.innerHTML = `
            <div class="type-indicator" style="background:var(--holiday)"></div>
            <div class="time-box">
                <i class="ph-bold ph-flag" style="font-size:1.2rem; color:var(--holiday)"></i>
            </div>
            <div class="event-info">
                <div class="event-title">🇵🇭 ${holiday.name}</div>
                <div class="event-desc">Holiday</div>
            </div>
        `;
        list.appendChild(holCard);
    }

    const dayEvents = events.filter(e => e.dateKey === key).sort((a,b) => {
        if (a.status === 'done' && b.status !== 'done') return 1;
        if (a.status !== 'done' && b.status === 'done') return -1;
        return a.time.localeCompare(b.time);
    });

    if(dayEvents.length === 0 && !holiday) {
        list.innerHTML = `<div style="text-align:center; padding:30px; opacity:0.4; font-size:0.9rem;">No items</div>`;
        return;
    }

    dayEvents.forEach(evt => {
        let barColor = 'var(--warning)';
        if(evt.type === 'payment') barColor = 'var(--danger)';
        if(evt.type === 'todo') barColor = 'var(--success)';

        const isDone = evt.status === 'done';
        const [h, m] = evt.time.split(':');
        const hour = parseInt(h);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const hour12 = hour % 12 || 12;

        const card = document.createElement('div');
        card.className = `event-card ${isDone ? 'done' : ''}`;
        card.id = `card-${evt.id}`;
        
        let recurrenceBadge = '';
        if(evt.recurrence && evt.recurrence !== 'none') {
            recurrenceBadge = `<span class="recurrence-badge">• ${evt.recurrence}</span>`;
        }

        card.innerHTML = `
            <div class="type-indicator" style="background:${barColor}"></div>
            <div class="time-box">
                <span class="time-text">${hour12}:${m}</span>
                <span class="time-ampm">${ampm}</span>
            </div>
            <div class="event-info">
                <div class="event-title">${evt.title}</div>
                <div class="event-desc">${evt.desc||'No details'} ${recurrenceBadge}</div>
            </div>
        `;
        list.appendChild(card);

        card.onclick = () => openModal(evt.type, evt.title, evt);
    });
}

/* --- MODAL LOGIC --- */
const modal = document.getElementById('modal');
const fabContainer = document.getElementById('fab-container');
document.getElementById('fab-main').onclick = (e) => { e.stopPropagation(); fabContainer.classList.toggle('open'); };
document.body.onclick = () => fabContainer.classList.remove('open');
window.closeModal = () => modal.classList.remove('active');

window.attemptCloseModal = () => {
    const id = document.getElementById('inp-id').value;
    const title = document.getElementById('inp-title').value;
    if(!id && title.trim().length > 0) {
        showConfirm("Discard Entry?", "Changes will be lost.", () => {
            closeModal();
        });
    } else {
        closeModal();
    }
};

document.querySelectorAll('.fab-option').forEach(btn => {
    btn.onclick = (e) => {
        e.stopPropagation();
        if(!currentUser) { showToast("Sign In Required", "ph-warning"); return; }
        openModal(btn.dataset.type, btn.dataset.label, null);
        fabContainer.classList.remove('open');
    };
});

function openModal(type, typeLabel, existingEvent) {
    const isEdit = !!existingEvent;
    document.getElementById('modal-title').textContent = isEdit ? "Edit Item" : "New " + typeLabel;
    document.getElementById('inp-id').value = isEdit ? existingEvent.id : "";
    document.getElementById('inp-type').value = isEdit ? existingEvent.type : type;
    document.getElementById('inp-title').value = isEdit ? existingEvent.title : "";
    document.getElementById('inp-time').value = isEdit ? existingEvent.time : "";
    document.getElementById('inp-desc').value = isEdit ? existingEvent.desc : "";
    
    const recurDiv = document.getElementById('div-recurring');
    const recurInp = document.getElementById('inp-recurring');
    
    if (type === 'payment' || (isEdit && existingEvent.type === 'payment')) {
        recurDiv.style.display = 'block';
        recurInp.value = isEdit && existingEvent.recurrence ? existingEvent.recurrence : 'none';
    } else {
        recurDiv.style.display = 'none';
        recurInp.value = 'none';
    }

    const actionsDiv = document.getElementById('modal-actions');
    const delBtn = document.getElementById('btn-delete-entry');
    const statusBtn = document.getElementById('btn-toggle-status');
    
    if (isEdit) {
        actionsDiv.classList.add('edit-mode');
        
        delBtn.onclick = () => {
            showConfirm("Delete Item", "This action cannot be undone.", async () => {
                closeModal();
                showToast("Item Deleted", "ph-trash");
                await deleteDoc(doc(db, `artifacts/${firebaseConfig.appId}/users/${currentUser.uid}/events`, existingEvent.id));
            });
        };
        
        const isDone = existingEvent.status === 'done';
        statusBtn.textContent = isDone ? "Mark Active" : "Mark Done";
        statusBtn.style.background = isDone ? "var(--text-secondary)" : "var(--success)";
        
        statusBtn.onclick = async () => {
                const newStatus = isDone ? 'active' : 'done';
                closeModal();
                showToast(newStatus === 'done' ? "Marked Done" : "Marked Active");
                await updateDoc(doc(db, `artifacts/${firebaseConfig.appId}/users/${currentUser.uid}/events`, existingEvent.id), { status: newStatus });
        };

    } else {
        actionsDiv.classList.remove('edit-mode');
    }
    
    modal.classList.add('active');
}

document.getElementById('event-form').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('inp-id').value;
    const data = {
        type: document.getElementById('inp-type').value,
        title: document.getElementById('inp-title').value,
        time: document.getElementById('inp-time').value,
        desc: document.getElementById('inp-desc').value,
        recurrence: document.getElementById('inp-recurring').value,
        dateKey: formatDate(selectedDate)
    };

    closeModal();
    const actionMsg = id ? "Changes Saved" : "Item Added";
    showToast(actionMsg);

    try {
        if (id) {
            await updateDoc(doc(db, `artifacts/${firebaseConfig.appId}/users/${currentUser.uid}/events`, id), data);
        } else {
            data.status = 'active';
            data.createdAt = new Date().toISOString();
            await addDoc(collection(db, `artifacts/${firebaseConfig.appId}/users/${currentUser.uid}/events`), data);
        }
        e.target.reset();
    } catch(err) { 
        showToast("Error Saving", "ph-warning"); 
        console.error(err); 
    }
};

const formatDate = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
document.getElementById('prev-month').onclick = () => { viewDate.setMonth(viewDate.getMonth()-1); render(); };
document.getElementById('next-month').onclick = () => { viewDate.setMonth(viewDate.getMonth()+1); render(); };

render();