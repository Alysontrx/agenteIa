// Establish connection with Socket.io server
const socket = io();

// ==========================================
// STATE MANAGEMENT
// ==========================================
let appState = {
    whatsappStatus: 'disconnected',
    systemInstruction: '',
    conversations: {}, // Map (phone -> conversation object)
    activeContactPhone: null,
    totalMessages: 0
};

// ==========================================
// DOM ELEMENTS
// ==========================================
const elStatusDot = document.querySelector('#status-indicator .status-dot');
const elStatusText = document.querySelector('#status-indicator .status-text');
const elTopbarStatusDot = document.getElementById('topbar-status-dot');
const elTopbarStatusText = document.getElementById('topbar-status-text');
const elQrContainer = document.getElementById('qr-container');
const elQrImage = document.getElementById('qr-image');
const elConversationsList = document.getElementById('conversations-list');
const elSearchInput = document.getElementById('search-input');

const elChatHeader = document.getElementById('chat-header');
const elActiveContactName = document.getElementById('active-contact-name');
const elActiveContactPhone = document.getElementById('active-contact-phone');
const elMessagesContainer = document.getElementById('messages-container');
const elMessageInput = document.getElementById('message-input');
const elBtnSendMessage = document.getElementById('btn-send-message');
const elBtnResetChat = document.getElementById('btn-reset-chat');
const elBtnToggleAi = document.getElementById('btn-toggle-ai');

// Elements: Right Details Sidebar
const elDetailsSidebar = document.getElementById('details-sidebar');
const elDetailsWelcome = document.getElementById('details-welcome');
const elDetailsContent = document.getElementById('details-content');
const elDetailsName = document.getElementById('details-name');
const elDetailsPhone = document.getElementById('details-phone');
const elSelectFunnelStage = document.getElementById('select-funnel-stage');
const elTextareaClientNotes = document.getElementById('textarea-client-notes');
const elBtnSaveNotes = document.getElementById('btn-save-notes');
const elBtnSidebarToggleAi = document.getElementById('btn-sidebar-toggle-ai');

const elMetricActiveChats = document.getElementById('metric-total-leads');
const elMetricTotalMessages = document.getElementById('metric-total-messages');

const elPromptInput = document.getElementById('prompt-input');
const elBtnSavePrompt = document.getElementById('btn-save-prompt');
const elToastContainer = document.getElementById('toast-container');

// Hide chat input and header initially
if (elChatHeader) elChatHeader.style.visibility = 'hidden';
const elChatInputArea = document.getElementById('chat-input-area');

// ==========================================
// TABS & NAVIGATION SYSTEM
// ==========================================
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        // Remove active class from all buttons and contents
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        // Activate selected tab
        btn.classList.add('active');
        const targetTabId = btn.getAttribute('data-tab');
        const targetContent = document.getElementById(targetTabId);
        if (targetContent) targetContent.classList.add('active');

        // Trigger Kanban layout rendering if navigating to Kanban
        if (targetTabId === 'tab-funnel') {
            renderKanbanBoard();
        }
    });
});

// ==========================================
// INITIALIZE & DATA FETCHING
// ==========================================
socket.on('init-data', (data) => {
    console.log('[Socket] Conectado e inicializado com os dados:', data);
    
    appState.whatsappStatus = data.status;
    appState.systemInstruction = data.systemInstruction;
    
    // Popula prompt
    if (elPromptInput) elPromptInput.value = data.systemInstruction;
    
    // Processa conversas
    appState.conversations = {};
    appState.totalMessages = 0;
    
    data.conversations.forEach(conv => {
        appState.conversations[conv.phone] = conv;
        appState.totalMessages += conv.messages ? conv.messages.length : 0;
    });

    // Atualiza interface
    updateWhatsappStatusUI(data.status, data.qr);
    renderConversationsList();
    renderKanbanBoard();
    updateMetrics();
    
    showToast('Conectado ao painel CRM!', 'info');
});

// Evento: Conversas em segundo plano carregadas do celular
socket.on('conversations-loaded', (conversations) => {
    console.log('[Socket] Chats reais sincronizados do aparelho:', conversations);
    conversations.forEach(conv => {
        if (!appState.conversations[conv.phone]) {
            appState.conversations[conv.phone] = conv;
        } else {
            appState.conversations[conv.phone].name = conv.name;
            appState.conversations[conv.phone].lastMessage = conv.lastMessage;
            appState.conversations[conv.phone].timestamp = conv.timestamp;
            // Mantém stage e notes se o servidor ainda não sincronizou
            if (conv.stage !== undefined) appState.conversations[conv.phone].stage = conv.stage;
            if (conv.notes !== undefined) appState.conversations[conv.phone].notes = conv.notes;
            if (conv.aiEnabled !== undefined) appState.conversations[conv.phone].aiEnabled = conv.aiEnabled;
        }
    });
    renderConversationsList();
    renderKanbanBoard();
    updateMetrics();
});

// ==========================================
// WHATSAPP CONNECTION STATUS MANAGEMENT
// ==========================================
socket.on('status-update', (data) => {
    console.log('[Socket] Atualização de Status:', data);
    appState.whatsappStatus = data.status;
    updateWhatsappStatusUI(data.status, data.qr);
});

function updateWhatsappStatusUI(status, qr) {
    // Reset indicators
    if (elStatusDot) elStatusDot.className = 'status-dot';
    if (elTopbarStatusDot) elTopbarStatusDot.className = 'status-dot';
    
    if (status === 'connected') {
        if (elStatusDot) elStatusDot.classList.add('status-online');
        if (elStatusText) elStatusText.textContent = 'Conectado';
        
        if (elTopbarStatusDot) elTopbarStatusDot.classList.add('status-online');
        if (elTopbarStatusText) elTopbarStatusText.textContent = 'Conectado';
        
        if (elQrContainer) elQrContainer.style.display = 'none';
        showToast('WhatsApp está online e ativo!', 'success');
    } else if (status === 'scanning') {
        if (elStatusDot) elStatusDot.classList.add('status-connecting');
        if (elStatusText) elStatusText.textContent = 'Aguardando QR Code';
        
        if (elTopbarStatusDot) elTopbarStatusDot.classList.add('status-connecting');
        if (elTopbarStatusText) elTopbarStatusText.textContent = 'Escanear QR';
        
        if (qr) {
            if (elQrContainer) elQrContainer.style.display = 'block';
            if (elQrImage) elQrImage.src = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
        }
    } else {
        if (elStatusDot) elStatusDot.classList.add('status-offline');
        if (elStatusText) elStatusText.textContent = 'Desconectado';
        
        if (elTopbarStatusDot) elTopbarStatusDot.classList.add('status-offline');
        if (elTopbarStatusText) elTopbarStatusText.textContent = 'Desconectado';
        
        if (elQrContainer) elQrContainer.style.display = 'none';
    }
}

// ==========================================
// RENDER MESSAGES & CHAT
// ==========================================
function selectConversation(phone) {
    appState.activeContactPhone = phone;
    const conv = appState.conversations[phone];
    if (!conv) return;

    // Remove classe ativa antiga e adiciona na nova
    document.querySelectorAll('.conv-item').forEach(item => {
        item.classList.remove('active');
    });
    const activeEl = document.querySelector(`.conv-item[data-phone="${phone}"]`);
    if (activeEl) activeEl.classList.add('active');

    // Revela Cabeçalho e Input
    if (elChatHeader) elChatHeader.style.visibility = 'visible';
    if (elActiveContactName) elActiveContactName.textContent = conv.name;
    if (elActiveContactPhone) elActiveContactPhone.textContent = formatPhoneNumber(phone);
    if (elMessageInput) {
        elMessageInput.disabled = false;
        elMessageInput.placeholder = "Digite uma resposta manual para intervir...";
    }
    if (elBtnSendMessage) elBtnSendMessage.disabled = false;

    // Se o chat ainda não tem mensagens carregadas, mostra o indicador de loading
    if (!conv.messages || conv.messages.length === 0) {
        elMessagesContainer.innerHTML = `
            <div class="welcome-screen">
                <i class="fa-solid fa-circle-notch fa-spin"></i>
                <h2>Buscando histórico real...</h2>
                <p>Sincronizando as últimas mensagens do seu celular.</p>
            </div>`;
    } else {
        renderActiveChatMessages();
    }

    // Atualiza o estado visual do botão de alternar IA
    updateAiToggleButtonUI(conv.aiEnabled);

    // Atualiza a barra lateral de detalhes do contato
    updateDetailsSidebar(phone);

    // Solicita o histórico real mais recente ao servidor via Socket
    socket.emit('get-chat-history', phone);
}

function updateAiToggleButtonUI(enabled) {
    if (!elBtnToggleAi) return;
    
    if (enabled !== false) { // Habilitada por padrão
        elBtnToggleAi.className = 'btn btn-ai-toggle';
        elBtnToggleAi.querySelector('span').textContent = 'IA Ativa';
        elBtnToggleAi.querySelector('i').className = 'fa-solid fa-robot';
    } else {
        elBtnToggleAi.className = 'btn btn-ai-toggle ai-paused';
        elBtnToggleAi.querySelector('span').textContent = 'IA Pausada';
        elBtnToggleAi.querySelector('i').className = 'fa-solid fa-circle-pause';
    }
}

function renderActiveChatMessages() {
    const phone = appState.activeContactPhone;
    const conv = appState.conversations[phone];
    if (!conv) return;

    elMessagesContainer.innerHTML = '';

    if (conv.messages.length === 0) {
        elMessagesContainer.innerHTML = `
            <div class="welcome-screen">
                <i class="fa-regular fa-message"></i>
                <h2>Início de conversa</h2>
                <p>Nenhuma mensagem trocada ainda.</p>
            </div>`;
        return;
    }

    conv.messages.forEach(msg => {
        const row = document.createElement('div');
        row.className = `message-row ${msg.sender}`; // client | ai | agent

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        bubble.textContent = msg.body;

        const meta = document.createElement('span');
        meta.className = 'message-meta';
        meta.textContent = formatTime(msg.timestamp);
        
        bubble.appendChild(meta);
        row.appendChild(bubble);
        elMessagesContainer.appendChild(row);
    });

    // Rola para o final da tela com suavidade
    setTimeout(() => {
        elMessagesContainer.scrollTop = elMessagesContainer.scrollHeight;
    }, 50);
}

// ==========================================
// RENDER DETAILS SIDEBAR (BARRA DIREITA)
// ==========================================
function updateDetailsSidebar(phone) {
    if (!elDetailsSidebar) return;

    if (!phone) {
        if (elDetailsWelcome) elDetailsWelcome.style.display = 'flex';
        if (elDetailsContent) elDetailsContent.style.display = 'none';
        return;
    }

    const conv = appState.conversations[phone];
    if (!conv) return;

    if (elDetailsWelcome) elDetailsWelcome.style.display = 'none';
    if (elDetailsContent) elDetailsContent.style.display = 'block';

    if (elDetailsName) elDetailsName.textContent = conv.name;
    if (elDetailsPhone) elDetailsPhone.textContent = formatPhoneNumber(phone);
    if (elSelectFunnelStage) elSelectFunnelStage.value = conv.stage || 'lead';
    if (elTextareaClientNotes) elTextareaClientNotes.value = conv.notes || '';

    // Atualiza botão lateral da IA
    updateSidebarAiButtonUI(conv.aiEnabled);
}

function updateSidebarAiButtonUI(enabled) {
    if (!elBtnSidebarToggleAi) return;
    
    if (enabled !== false) {
        elBtnSidebarToggleAi.className = 'btn btn-ai-toggle btn-full';
        elBtnSidebarToggleAi.querySelector('span').textContent = 'IA Ativa';
        elBtnSidebarToggleAi.querySelector('i').className = 'fa-solid fa-robot';
    } else {
        elBtnSidebarToggleAi.className = 'btn btn-ai-toggle btn-full ai-paused';
        elBtnSidebarToggleAi.querySelector('span').textContent = 'IA Pausada';
        elBtnSidebarToggleAi.querySelector('i').className = 'fa-solid fa-circle-pause';
    }
}

// Evento: Clique em Salvar Notas
if (elBtnSaveNotes) {
    elBtnSaveNotes.addEventListener('click', () => {
        const phone = appState.activeContactPhone;
        if (!phone) return;

        const notes = elTextareaClientNotes.value;
        elBtnSaveNotes.disabled = true;
        elBtnSaveNotes.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
        
        socket.emit('update-client-notes', { phone, notes });
    });
}

// Evento: Mudar Etapa do Funil no Dropdown
if (elSelectFunnelStage) {
    elSelectFunnelStage.addEventListener('change', () => {
        const phone = appState.activeContactPhone;
        const stage = elSelectFunnelStage.value;
        if (!phone || !stage) return;

        socket.emit('update-client-stage', { phone, stage });
    });
}

// Evento: Toggle IA na barra lateral
if (elBtnSidebarToggleAi) {
    elBtnSidebarToggleAi.addEventListener('click', () => {
        const phone = appState.activeContactPhone;
        if (!phone) return;

        const conv = appState.conversations[phone];
        const nextEnabled = !(conv.aiEnabled !== false);

        socket.emit('toggle-ai', { phone, enabled: nextEnabled });
    });
}

// ==========================================
// RENDER KANBAN SALES FUNNEL (ABA 2)
// ==========================================
function renderKanbanBoard() {
    const columns = {
        lead: document.getElementById('cards-lead'),
        progress: document.getElementById('cards-progress'),
        quote: document.getElementById('cards-quote'),
        won: document.getElementById('cards-won'),
        lost: document.getElementById('cards-lost')
    };

    // Limpa as colunas se existirem
    Object.keys(columns).forEach(key => {
        if (columns[key]) columns[key].innerHTML = '';
    });

    // Contadores
    const counts = { lead: 0, progress: 0, quote: 0, won: 0, lost: 0 };

    Object.values(appState.conversations).forEach(conv => {
        const stage = conv.stage || 'lead';
        counts[stage]++;

        const colEl = columns[stage];
        if (!colEl) return;

        const card = document.createElement('div');
        card.className = 'kanban-card';
        card.setAttribute('draggable', 'true');
        card.setAttribute('data-phone', conv.phone);

        // Drag events
        card.addEventListener('dragstart', (ev) => {
            ev.dataTransfer.setData("text/plain", conv.phone);
            card.style.opacity = '0.5';
        });

        card.addEventListener('dragend', () => {
            card.style.opacity = '1';
        });

        // Click event -> Abre o chat e muda de aba
        card.addEventListener('click', () => {
            selectConversation(conv.phone);
            const chatTabBtn = document.querySelector('.tab-btn[data-tab="tab-chat"]');
            if (chatTabBtn) chatTabBtn.click();
        });

        const timeStr = formatTime(conv.timestamp);
        const aiActive = conv.aiEnabled !== false;

        card.innerHTML = `
            <div class="card-title">
                <span>${conv.name}</span>
                <i class="fa-solid fa-circle-chevron-right"></i>
            </div>
            <div class="card-phone">${formatPhoneNumber(conv.phone)}</div>
            <div class="card-preview">${conv.lastMessage || 'Sem mensagens...'}</div>
            <div class="card-footer">
                <span class="card-badge ${aiActive ? 'ai-active' : 'ai-paused'}">${aiActive ? 'IA Ativa' : 'IA Pausada'}</span>
                <span class="card-time">${timeStr}</span>
            </div>
        `;

        colEl.appendChild(card);
    });

    // Atualiza contadores
    Object.keys(counts).forEach(stage => {
        const countEl = document.getElementById(`count-${stage}`);
        if (countEl) countEl.textContent = counts[stage];
    });
}

// Bind Drag & Drop Events on Column Containers dynamically
document.querySelectorAll('.kanban-cards').forEach(col => {
    col.addEventListener('dragover', (ev) => {
        ev.preventDefault();
        col.classList.add('drag-over');
    });

    col.addEventListener('dragleave', () => {
        col.classList.remove('drag-over');
    });

    col.addEventListener('drop', (ev) => {
        ev.preventDefault();
        col.classList.remove('drag-over');
        const phone = ev.dataTransfer.getData("text/plain");
        const stage = col.parentElement.getAttribute('data-stage');
        
        if (phone && stage) {
            socket.emit('update-client-stage', { phone, stage });
        }
    });
});

// ==========================================
// REAL-TIME MESSAGE EVENT LISTENERS
// ==========================================
// Evento: Histórico de chat carregado sob demanda
socket.on('chat-history', (data) => {
    const { phone, messages } = data;
    console.log(`[Socket] Histórico real recebido para ${phone}:`, messages);
    
    if (appState.conversations[phone]) {
        appState.conversations[phone].messages = messages;
        
        // Recalcula total de mensagens
        appState.totalMessages = Object.values(appState.conversations).reduce((acc, c) => acc + (c.messages ? c.messages.length : 0), 0);
        updateMetrics();
    }

    // Se o chat ativo ainda for este, renderiza
    if (appState.activeContactPhone === phone) {
        renderActiveChatMessages();
    }
});

// Evento: Status da IA alterado (Habilitado/Pausado)
socket.on('ai-status-change', (data) => {
    const { phone, aiEnabled } = data;
    
    if (appState.conversations[phone]) {
        appState.conversations[phone].aiEnabled = aiEnabled;
    }
    
    if (appState.activeContactPhone === phone) {
        updateAiToggleButtonUI(aiEnabled);
        updateSidebarAiButtonUI(aiEnabled);
        showToast(
            aiEnabled ? 'Inteligência Artificial ativa!' : 'IA Pausada. Responda manualmente.',
            aiEnabled ? 'success' : 'info'
        );
    }
    
    renderKanbanBoard();
});

// Evento: Notas do cliente atualizadas
socket.on('client-notes-updated', (data) => {
    const { phone, notes } = data;
    
    if (appState.conversations[phone]) {
        appState.conversations[phone].notes = notes;
    }

    if (appState.activeContactPhone === phone) {
        if (elTextareaClientNotes) elTextareaClientNotes.value = notes;
        if (elBtnSaveNotes) {
            elBtnSaveNotes.disabled = false;
            elBtnSaveNotes.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar Observações';
        }
        showToast('Anotações do cliente salvas!', 'success');
    }
});

// Evento: Etapa do Kanban atualizada
socket.on('client-stage-updated', (data) => {
    const { phone, stage } = data;
    
    if (appState.conversations[phone]) {
        appState.conversations[phone].stage = stage;
    }

    if (appState.activeContactPhone === phone) {
        if (elSelectFunnelStage) elSelectFunnelStage.value = stage;
        showToast(`Funil atualizado: ${getStageLabel(stage)}`, 'success');
    }

    renderKanbanBoard();
});

// Receber novas mensagens em tempo real
socket.on('message-update', (data) => {
    const { phone, name, lastMessage, timestamp, newMessage } = data;
    
    // Se a conversa não existir no estado, cria ela
    if (!appState.conversations[phone]) {
        appState.conversations[phone] = {
            phone,
            name,
            lastMessage: '',
            timestamp: null,
            messages: [],
            stage: 'lead',
            notes: '',
            aiEnabled: true
        };
        showToast(`Nova conversa de ${name}!`, 'info');
    }

    const conv = appState.conversations[phone];
    if (!conv.messages) conv.messages = [];
    conv.messages.push(newMessage);
    conv.lastMessage = lastMessage;
    conv.timestamp = timestamp;
    appState.totalMessages++;

    // Atualiza Sidebar & Kanban
    renderConversationsList();
    renderKanbanBoard();
    updateMetrics();

    // Se for o chat aberto, renderiza
    if (appState.activeContactPhone === phone) {
        renderActiveChatMessages();
    }
});

// Evento: Chat Resetado
socket.on('chat-reset', (data) => {
    const { phone } = data;
    if (appState.conversations[phone]) {
        appState.totalMessages -= appState.conversations[phone].messages ? appState.conversations[phone].messages.length : 0;
        delete appState.conversations[phone];
    }
    
    if (appState.activeContactPhone === phone) {
        appState.activeContactPhone = null;
        if (elChatHeader) elChatHeader.style.visibility = 'hidden';
        if (elMessageInput) {
            elMessageInput.disabled = true;
            elMessageInput.value = '';
        }
        if (elBtnSendMessage) elBtnSendMessage.disabled = true;
        elMessagesContainer.innerHTML = `
            <div class="welcome-screen">
                <i class="fa-solid fa-comments"></i>
                <h2>Bem-vindo ao WPP AI CRM</h2>
                <p>Selecione um cliente ao lado para ver o histórico e interagir em tempo real.</p>
            </div>`;
        updateDetailsSidebar(null);
    }

    renderConversationsList();
    renderKanbanBoard();
    updateMetrics();
    showToast('Conversa limpa com sucesso!', 'success');
});

// ==========================================
// RENDER CONVERSATIONS LIST (SIDEBAR)
// ==========================================
function renderConversationsList(filterQuery = '') {
    if (!elConversationsList) return;
    
    elConversationsList.innerHTML = '';
    
    const sortedConversations = Object.values(appState.conversations).sort((a, b) => {
        return new Date(b.timestamp) - new Date(a.timestamp);
    });

    const filtered = sortedConversations.filter(conv => {
        const query = filterQuery.toLowerCase();
        return conv.name.toLowerCase().includes(query) || conv.phone.includes(query);
    });

    if (filtered.length === 0) {
        elConversationsList.innerHTML = `
            <div class="empty-list">
                <i class="fa-regular fa-comments"></i>
                <p>${filterQuery ? 'Nenhum resultado' : 'Nenhuma conversa ativa'}</p>
            </div>`;
        return;
    }

    filtered.forEach(conv => {
        const isActive = appState.activeContactPhone === conv.phone;
        
        const el = document.createElement('div');
        el.className = `conv-item ${isActive ? 'active' : ''}`;
        el.setAttribute('data-phone', conv.phone);
        
        const initial = conv.name.charAt(0).toUpperCase();

        el.innerHTML = `
            <div class="conv-avatar">${initial}</div>
            <div class="conv-details">
                <div class="conv-details-top">
                    <span class="conv-name">${conv.name}</span>
                    <span class="conv-time">${formatTime(conv.timestamp)}</span>
                </div>
                <div class="conv-preview">${conv.lastMessage || 'Sem mensagens...'}</div>
            </div>`;

        el.addEventListener('click', () => selectConversation(conv.phone));
        elConversationsList.appendChild(el);
    });
}

// Filtro de Busca
if (elSearchInput) {
    elSearchInput.addEventListener('input', (e) => {
        renderConversationsList(e.target.value);
    });
}

// ==========================================
// SEND MANUAL MESSAGE (CRM INTERVENTION)
// ==========================================
function sendManualMessage() {
    if (!elMessageInput) return;
    
    const text = elMessageInput.value.trim();
    const phone = appState.activeContactPhone;
    
    if (!text || !phone) return;

    // Desativa input temporariamente
    elMessageInput.disabled = true;
    if (elBtnSendMessage) elBtnSendMessage.disabled = true;

    // Envia ao servidor
    socket.emit('send-manual-message', { phone, body: text });

    // Limpa input e reativa
    elMessageInput.value = '';
    elMessageInput.disabled = false;
    if (elBtnSendMessage) elBtnSendMessage.disabled = false;
    elMessageInput.focus();
}

if (elBtnSendMessage) elBtnSendMessage.addEventListener('click', sendManualMessage);
if (elMessageInput) {
    elMessageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            sendManualMessage();
        }
    });
}

// ==========================================
// RESET CHAT BUTTON & TOGGLE AI BUTTON
// ==========================================
if (elBtnResetChat) {
    elBtnResetChat.addEventListener('click', () => {
        const phone = appState.activeContactPhone;
        if (!phone) return;

        if (confirm('Deseja resetar esta conversa? O bot esquecerá todo o histórico.')) {
            socket.emit('reset-client-chat', phone);
        }
    });
}

if (elBtnToggleAi) {
    elBtnToggleAi.addEventListener('click', () => {
        const phone = appState.activeContactPhone;
        if (!phone) return;

        const conv = appState.conversations[phone];
        const nextEnabled = !(conv.aiEnabled !== false);

        socket.emit('toggle-ai', { phone, enabled: nextEnabled });
    });
}

// ==========================================
// SAVE PROMPT CONFIGURATION
// ==========================================
if (elBtnSavePrompt) {
    elBtnSavePrompt.addEventListener('click', () => {
        const newPrompt = elPromptInput.value.trim();
        if (!newPrompt) {
            showToast('As instruções não podem estar vazias!', 'error');
            return;
        }

        elBtnSavePrompt.disabled = true;
        elBtnSavePrompt.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';

        socket.emit('save-prompt', newPrompt);
    });
}

socket.on('prompt-updated', (data) => {
    appState.systemInstruction = data.systemInstruction;
    if (elPromptInput) elPromptInput.value = data.systemInstruction;
    
    if (elBtnSavePrompt) {
        elBtnSavePrompt.disabled = false;
        elBtnSavePrompt.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar Personalidade';
    }
    
    showToast('Personalidade da IA atualizada com sucesso!', 'success');
});

// ==========================================
// HELPER FUNCTIONS (METRICS & FORMATTING)
// ==========================================
function updateMetrics() {
    const totalLeads = Object.keys(appState.conversations).length;
    if (elMetricActiveChats) elMetricActiveChats.textContent = totalLeads;
    if (elMetricTotalMessages) elMetricTotalMessages.textContent = appState.totalMessages;
}

function showToast(message, type = 'info') {
    if (!elToastContainer) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = '<i class="fa-solid fa-circle-info"></i>';
    if (type === 'success') icon = '<i class="fa-solid fa-circle-check"></i>';
    if (type === 'error') icon = '<i class="fa-solid fa-circle-exclamation"></i>';

    toast.innerHTML = `${icon} <span>${message}</span>`;
    elToastContainer.appendChild(toast);

    // Remove após 4 segundos
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s reverse';
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 4000);
}

function getStageLabel(stage) {
    switch (stage) {
        case 'lead': return '📥 Novo Lead';
        case 'progress': return '💬 Em Atendimento';
        case 'quote': return '📝 Orçamento Criado';
        case 'won': return '🏆 Venda Concluída';
        case 'lost': return '❌ Perdido';
        default: return stage;
    }
}

function formatPhoneNumber(phone) {
    if (!phone) return '-';
    
    if (phone.includes('@lid')) return 'Oculto (API)';

    const num = phone.split('@')[0];
    
    if (num.length >= 14) {
        return num; 
    }

    if (num.startsWith('55') && (num.length === 12 || num.length === 13)) {
        const ddd = num.slice(2, 4);
        const prefix = num.slice(4, num.length - 4);
        const suffix = num.slice(num.length - 4);
        return `+55 (${ddd}) ${prefix}-${suffix}`;
    }

    if (num.length >= 12 && num.length <= 13) {
        return `+${num.slice(0, 2)} (${num.slice(2, 4)}) ${num.slice(4, 9)}-${num.slice(9)}`;
    }
    
    return `+${num}`;
}

function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

socket.on('error-msg', (data) => {
    showToast(data.message, 'error');
});
