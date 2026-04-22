// ==========================================
// Productivity JABIL DR - FIREBASE REALTIME
// ==========================================

const globalHours = [
    "07:00 - 08:00", "08:00 - 09:00", "09:00 - 10:00", "10:00 - 11:00",
    "11:00 - 12:00", "12:00 - 13:00", "13:00 - 14:00", "14:00 - 15:00",
    "15:00 - 16:00", "16:00 - 17:00", "17:00 - 18:00", "18:00 - 19:00",
    "19:00 - 20:00", "20:00 - 21:00", "21:00 - 22:00", "22:00 - 23:00", "23:00 - 00:00"
];

let appTechnicians = [];
let productivityData = {};
let productivityChartInstance = null;

// ------------------------------------------
// FIREBASE - Listeners en Tiempo Real
// ------------------------------------------
function setupFirebaseListeners() {
    // Verificar que Firebase está disponible
    if (!window.db) {
        console.error("❌ Firebase no disponible. Revisa las credenciales en index.html.");
        loadLocalFallback();
        return;
    }

    console.log("✅ Firebase activo. Escuchando cambios en tiempo real...");
    updateSyncStatus(true);

    // Escuchar técnicos en tiempo real
    window.db.ref('techs').on('value', (snapshot) => {
        const data = snapshot.val();
        appTechnicians = data ? Object.values(data) : [];
        localStorage.setItem('jabil_techs_list', JSON.stringify(appTechnicians));
        refreshUI();
    }, (error) => {
        console.error("Error leyendo técnicos:", error);
        updateSyncStatus(false);
    });

    // Escuchar datos de productividad en tiempo real
    // Firebase devuelve objetos cuando se usa .push(), los convertimos a arrays
    window.db.ref('productivity').on('value', (snapshot) => {
        const raw = snapshot.val() || {};

        // Convertir objetos de Firebase (.push) a arrays planos
        productivityData = {};
        Object.keys(raw).forEach(day => {
            productivityData[day] = {};
            Object.keys(raw[day] || {}).forEach(techId => {
                productivityData[day][techId] = {};
                Object.keys(raw[day][techId] || {}).forEach(hour => {
                    const hourData = raw[day][techId][hour];
                    // Si es objeto de Firebase (push), convertir a array
                    if (hourData && typeof hourData === 'object' && !Array.isArray(hourData)) {
                        productivityData[day][techId][hour] = Object.values(hourData);
                    } else {
                        productivityData[day][techId][hour] = Array.isArray(hourData) ? hourData : [];
                    }
                });
            });
        });

        localStorage.setItem('jabil_proto_data', JSON.stringify(productivityData));
        renderDashboard();
        updateKPIs();
        updateTotalGlobal();
        updateSyncStatus(true);
    }, (error) => {
        console.error("Error leyendo productividad:", error);
        updateSyncStatus(false);
    });
}

function loadLocalFallback() {
    appTechnicians = JSON.parse(localStorage.getItem('jabil_techs_list') || '[]');
    productivityData = JSON.parse(localStorage.getItem('jabil_proto_data') || '{}');
    if (appTechnicians.length === 0) {
        appTechnicians = [{ id: "JB-001", name: "Técnico Demo", pin: "1234" }];
    }
    refreshUI();
    updateKPIs();
    updateTotalGlobal();
}

// ------------------------------------------
// GUARDAR EN FIREBASE
// ------------------------------------------
async function saveTechToFirebase(tech) {
    if (!window.db) {
        // Sin Firebase: guardar en localStorage
        const idx = appTechnicians.findIndex(t => t.id === tech.id);
        if (idx >= 0) appTechnicians[idx] = tech;
        else appTechnicians.push(tech);
        localStorage.setItem('jabil_techs_list', JSON.stringify(appTechnicians));
        refreshUI();
        return;
    }
    await window.db.ref(`techs/${tech.id}`).set(tech);
}

async function deleteTechFromFirebase(techId) {
    if (!window.db) {
        appTechnicians = appTechnicians.filter(t => t.id !== techId);
        localStorage.setItem('jabil_techs_list', JSON.stringify(appTechnicians));
        refreshUI();
        return;
    }
    await window.db.ref(`techs/${techId}`).remove();
}

async function pushProductivityEntries(day, techId, hour, newEntries) {
    const safehour = hour.replace(/:/g, '-').replace(/ /g, '_');

    if (!window.db) {
        // Sin Firebase: acumular en local
        if (!productivityData[day]) productivityData[day] = {};
        if (!productivityData[day][techId]) productivityData[day][techId] = {};
        if (!productivityData[day][techId][safehour]) productivityData[day][techId][safehour] = [];
        newEntries.forEach(e => productivityData[day][techId][safehour].push(e));
        localStorage.setItem('jabil_proto_data', JSON.stringify(productivityData));
        renderDashboard();
        updateKPIs();
        updateTotalGlobal();
        return;
    }

    // Con Firebase: usar .push() para cada entrada (acumulativo, nunca sobreescribe)
    const ref = window.db.ref(`productivity/${day}/${techId}/${safehour}`);
    const pushPromises = newEntries.map(entry => ref.push(entry));
    await Promise.all(pushPromises);
}

// ------------------------------------------
// UI Helpers
// ------------------------------------------
function refreshUI() {
    if (window.refreshTechSelect) window.refreshTechSelect();
    if (window.renderAdminTable) window.renderAdminTable();
    renderDashboard();
}

function updateSyncStatus(online) {
    const el = document.getElementById('last-sync-time');
    if (!el) return;
    const t = new Date();
    const time = `${t.getHours().toString().padStart(2,'0')}:${t.getMinutes().toString().padStart(2,'0')}`;
    el.innerHTML = online
        ? `<i class="fa-solid fa-cloud-check" style="color:#22c55e"></i> Sync: ${time}`
        : `<i class="fa-solid fa-cloud-slash" style="color:#ef4444"></i> Sin conexión`;
}

// ------------------------------------------
// KPIs
// ------------------------------------------
function updateKPIs() {
    const today = new Date().toISOString().split('T')[0];
    const monthPrefix = today.substring(0, 7);

    let shiftLeader = { name: "---", count: 0 };
    let monthLeader = { name: "---", count: 0 };
    let totalToday = 0;
    const dailyTotals = {};
    const monthlyTotals = {};

    Object.keys(productivityData).forEach(day => {
        Object.keys(productivityData[day] || {}).forEach(tid => {
            let count = 0;
            Object.values(productivityData[day][tid] || {}).forEach(items => {
                count += Array.isArray(items) ? items.length : 0;
            });
            if (day === today) {
                dailyTotals[tid] = (dailyTotals[tid] || 0) + count;
                totalToday += count;
            }
            if (day.startsWith(monthPrefix)) {
                monthlyTotals[tid] = (monthlyTotals[tid] || 0) + count;
            }
        });
    });

    Object.keys(dailyTotals).forEach(tid => {
        if (dailyTotals[tid] > shiftLeader.count) {
            const t = appTechnicians.find(t => t.id === tid);
            shiftLeader = { name: t ? t.name : tid, count: dailyTotals[tid] };
        }
    });
    Object.keys(monthlyTotals).forEach(tid => {
        if (monthlyTotals[tid] > monthLeader.count) {
            const t = appTechnicians.find(t => t.id === tid);
            monthLeader = { name: t ? t.name : tid, count: monthlyTotals[tid] };
        }
    });

    let h = new Date().getHours() - 7;
    if (h <= 0) h = 1;
    const efficiency = (totalToday / h).toFixed(1);

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('total-hoy', totalToday);
    set('shift-leader-name', shiftLeader.name);
    set('shift-leader-count', `${shiftLeader.count} unidades`);
    set('month-leader-name', monthLeader.name);
    set('month-leader-count', `${monthLeader.count} unidades`);
    set('avg-efficiency', efficiency);
}

function updateTotalGlobal() {
    const start = document.getElementById('filter-date-start')?.value || '';
    const end = document.getElementById('filter-date-end')?.value || '';
    let total = 0;
    Object.keys(productivityData).forEach(d => {
        if (d >= start && d <= end) {
            Object.values(productivityData[d] || {}).forEach(tData =>
                Object.values(tData || {}).forEach(items => { total += Array.isArray(items) ? items.length : 0; })
            );
        }
    });
    const el = document.getElementById('total-hoy');
    if (el) el.textContent = total;
}

// ------------------------------------------
// INIT
// ------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    setupFirebaseListeners();
    updateDate();
    initNavigation();
    initForm();
    initAdmin();

    if (localStorage.getItem('jabil_theme') === 'dark') {
        document.body.setAttribute('data-theme', 'dark');
    }
});

// ------------------------------------------
// DATE / CLOCK
// ------------------------------------------
function updateDate() {
    const el = document.getElementById('current-date');
    if (el) el.textContent = new Date().toLocaleDateString('es-DO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const nowStr = new Date().toISOString().split('T')[0];
    const s = document.getElementById('filter-date-start');
    const e = document.getElementById('filter-date-end');
    if (s && !s.value) s.value = nowStr;
    if (e && !e.value) e.value = nowStr;

    [s, e].forEach(el => {
        if (el) el.addEventListener('change', () => {
            updateKPIs();
            renderDashboard();
            if (document.getElementById('grafica-view')?.classList.contains('active')) renderChart();
        });
    });

    initClock();

    const tt = document.getElementById('theme-toggle');
    if (tt) {
        tt.addEventListener('click', () => {
            const dark = document.body.getAttribute('data-theme') === 'dark';
            document.body.setAttribute('data-theme', dark ? 'light' : 'dark');
            localStorage.setItem('jabil_theme', dark ? 'light' : 'dark');
            tt.innerHTML = dark ? '<i class="fa-solid fa-moon"></i>' : '<i class="fa-solid fa-sun"></i>';
        });
    }

    const exp = document.getElementById('btn-export-excel');
    if (exp) exp.addEventListener('click', exportToExcel);
}

function initClock() {
    const el = document.getElementById('live-clock-display');
    if (el) setInterval(() => { el.textContent = new Date().toLocaleTimeString('es-DO', { hour12: false }); }, 1000);
}

// ------------------------------------------
// NAVIGATION
// ------------------------------------------
function initNavigation() {
    const navBtns = document.querySelectorAll('.nav-btn');
    const views = document.querySelectorAll('.view');
    const modal = document.getElementById('admin-auth-modal');
    const passInput = document.getElementById('admin-password-input');
    let authCb = null;

    window.showAdminAuthModal = (cb) => {
        authCb = cb;
        passInput.value = '';
        const stored = localStorage.getItem('jabil_admin_password');
        document.getElementById('auth-modal-desc').textContent = stored ? "Ingresa la Clave Maestra." : "Crea una Clave Maestra (mínimo 3 caracteres):";
        modal.classList.add('active');
        setTimeout(() => passInput.focus(), 100);
    };

    document.getElementById('btn-auth-cancel').onclick = () => modal.classList.remove('active');
    document.getElementById('btn-auth-submit').onclick = () => {
        const val = passInput.value;
        const stored = localStorage.getItem('jabil_admin_password');
        if (!stored && val.length >= 3) {
            localStorage.setItem('jabil_admin_password', val);
            modal.classList.remove('active');
            if (authCb) authCb();
        } else if (val === stored) {
            modal.classList.remove('active');
            if (authCb) authCb();
        } else {
            alert("Clave incorrecta.");
        }
    };

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-target');
            const action = () => {
                navBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                views.forEach(v => v.classList.remove('active'));
                document.getElementById(targetId).classList.add('active');
                if (targetId === 'dashboard-view') renderDashboard();
                if (targetId === 'grafica-view') renderChart();
            };
            if (targetId === 'tecnicos-view') window.showAdminAuthModal(action);
            else action();
        });
    });
}

// ------------------------------------------
// FORM (Registro)
// ------------------------------------------
function initForm() {
    const techSelect = document.getElementById('tech-select');
    const form = document.getElementById('registro-form');

    window.refreshTechSelect = () => {
        if (!techSelect) return;
        const cur = techSelect.value;
        techSelect.innerHTML = '<option value="" disabled selected>Selecciona un técnico</option>';
        appTechnicians.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.name;
            techSelect.appendChild(opt);
        });
        if (cur) techSelect.value = cur;
    };

    let isAuth = false;
    techSelect.addEventListener('change', () => {
        if (isAuth) return;
        const tech = appTechnicians.find(t => t.id === techSelect.value);
        if (tech && tech.pin) {
            isAuth = true;
            showTechPinModal(tech,
                () => { isAuth = false; document.getElementById('scanner-input')?.focus(); },
                () => { isAuth = false; techSelect.value = ''; }
            );
        }
    });

    const numInput = document.getElementById('repairs-input');
    document.querySelector('.decrease').onclick = () => { if (numInput.value > 1) numInput.value--; };
    document.querySelector('.increase').onclick = () => { numInput.value++; };

    const scanner = document.getElementById('scanner-input');
    if (scanner) {
        scanner.addEventListener('keypress', async (e) => {
            if (e.key !== 'Enter') return;
            const val = scanner.value.trim();
            if (!val) return;
            const found = appTechnicians.find(t => t.id === val);
            if (found) { techSelect.value = found.id; scanner.value = ''; return; }
            const tid = techSelect.value;
            if (!tid) { alert('Selecciona un técnico primero.'); scanner.value = ''; return; }
            await submitEntry(tid, [val]);
            scanner.value = '';
        });
    }

    if (form) {
        form.onsubmit = async (e) => {
            e.preventDefault();
            const tid = techSelect.value;
            if (!tid) return;
            const qty = parseInt(numInput.value) || 1;
            await submitEntry(tid, Array(qty).fill("Manual"));
            numInput.value = 1;
        };
    }
}

function autoDetectHour() {
    const h = new Date().getHours();
    return `${h.toString().padStart(2,'0')}:00 - ${(h+1).toString().padStart(2,'0')}:00`;
}

async function submitEntry(techId, serials) {
    const day = new Date().toISOString().split('T')[0];
    const hour = autoDetectHour();
    const ts = new Date().toLocaleTimeString('es-DO', { hour12: false }).substring(0, 5);

    // Construir las nuevas entradas a agregar
    const newEntries = serials.map(s => ({ serial: s, timestamp: ts }));

    // Usar push() para SUMAR al acumulado existente, nunca reemplazar
    await pushProductivityEntries(day, techId, hour, newEntries);
    showSuccessToast();
}

function showSuccessToast() {
    const toast = document.getElementById('success-toast');
    if (!toast) return;
    toast.style.display = 'flex';
    setTimeout(() => {
        toast.style.display = 'none';
        document.querySelector('[data-target="dashboard-view"]')?.click();
    }, 1500);
}

// ------------------------------------------
// DASHBOARD TABLE
// ------------------------------------------
function getFilteredItems(techId, hour) {
    const start = document.getElementById('filter-date-start')?.value || '';
    const end = document.getElementById('filter-date-end')?.value || '';
    let items = [];
    const safehour = hour.replace(/:/g, '-').replace(/ /g, '_');

    Object.keys(productivityData).forEach(day => {
        if (day >= start && day <= end) {
            const hourData = productivityData[day]?.[techId]?.[safehour]
                          || productivityData[day]?.[techId]?.[hour];
            if (Array.isArray(hourData)) items.push(...hourData);
        }
    });
    return items;
}

function renderDashboard() {
    const header = document.getElementById('table-header-row');
    const body = document.getElementById('dashboard-table-body');
    if (!header || !body) return;

    header.innerHTML = '<th>Técnico</th>' + globalHours.map(h => `<th>${h}</th>`).join('') + '<th class="total-col">Total</th>';

    body.innerHTML = appTechnicians.map(tech => {
        let rowTotal = 0;
        const cells = globalHours.map(hour => {
            const val = getFilteredItems(tech.id, hour).length;
            rowTotal += val;
            const cls = val === 0 ? 'zero' : val <= 5 ? 'heat-low' : val <= 10 ? 'heat-med' : 'heat-high';
            return `<td class="val-cell ${cls}">${val > 0 ? val : '-'}</td>`;
        }).join('');
        return `<tr><td>${tech.name}</td>${cells}<td class="val-cell total-col">${rowTotal}</td></tr>`;
    }).join('');
}

// ------------------------------------------
// CHART
// ------------------------------------------
function renderChart() {
    const canvas = document.getElementById('productivityChart');
    if (!canvas) return;
    const datasets = appTechnicians.map((tech, i) => ({
        label: tech.name,
        data: globalHours.map(h => getFilteredItems(tech.id, h).length),
        backgroundColor: `hsla(${i * 50}, 70%, 55%, 0.75)`
    }));
    if (productivityChartInstance) productivityChartInstance.destroy();
    productivityChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: { labels: globalHours.map(h => h.split(' ')[0]), datasets },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

// ------------------------------------------
// ADMIN - Técnicos
// ------------------------------------------
function showTechPinModal(tech, ok, cancel) {
    const m = document.getElementById('tech-auth-modal');
    const input = document.getElementById('tech-password-input');
    document.getElementById('tech-auth-desc').textContent = `Hola ${tech.name}, ingresa tu PIN:`;
    input.value = '';
    m.classList.add('active');
    setTimeout(() => input.focus(), 100);
    document.getElementById('btn-tech-cancel').onclick = () => { m.classList.remove('active'); cancel(); };
    document.getElementById('btn-tech-submit').onclick = () => {
        if (input.value === tech.pin) { m.classList.remove('active'); ok(); }
        else alert("PIN incorrecto");
    };
}

function initAdmin() {
    const body = document.getElementById('tech-admin-body');
    const idIn = document.getElementById('new-tech-id');
    const nameIn = document.getElementById('new-tech-name');
    const pinIn = document.getElementById('new-tech-pin');
    const subBtn = document.getElementById('btn-add-tech');
    let editId = null;

    window.renderAdminTable = () => {
        if (!body) return;
        body.innerHTML = appTechnicians.map(t => `
            <tr>
                <td>${t.id}</td>
                <td>${t.name}</td>
                <td>****</td>
                <td>
                    <button class="btn-primary" style="width:auto;padding:5px 10px;margin-right:5px;" onclick="editTech('${t.id}')"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn-danger" style="width:auto;padding:5px 10px;" onclick="deleteTech('${t.id}')"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>`).join('');
    };

    window.editTech = (id) => {
        editId = id;
        const t = appTechnicians.find(t => t.id === id);
        if (!t) return;
        idIn.value = t.id; idIn.disabled = true;
        nameIn.value = t.name; pinIn.value = t.pin;
        subBtn.innerHTML = '<i class="fa-solid fa-check"></i> Guardar';
        nameIn.focus();
    };

    window.deleteTech = async (id) => {
        const t = appTechnicians.find(t => t.id === id);
        if (!t) return;
        if (!confirm(`¿Eliminar a ${t.name}?`)) return;
        await deleteTechFromFirebase(id);
    };

    document.getElementById('add-tech-form').onsubmit = async (e) => {
        e.preventDefault();
        const tech = { id: idIn.value.trim(), name: nameIn.value.trim(), pin: pinIn.value.trim() };
        if (!tech.id || !tech.name || !tech.pin) return;
        await saveTechToFirebase(tech);
        editId = null;
        idIn.value = ''; idIn.disabled = false; nameIn.value = ''; pinIn.value = '';
        subBtn.innerHTML = '<i class="fa-solid fa-plus"></i>';
    };

    renderAdminTable();
}

// ------------------------------------------
// EXPORT
// ------------------------------------------
function exportToExcel() {
    let csv = "\uFEFFFecha,Técnico,Hora,Unidades\n";
    Object.keys(productivityData).forEach(d => {
        Object.keys(productivityData[d] || {}).forEach(tid => {
            Object.keys(productivityData[d][tid] || {}).forEach(h => {
                const count = (productivityData[d][tid][h] || []).length;
                csv += `"${d}","${tid}","${h}",${count}\n`;
            });
        });
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `productividad_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}
