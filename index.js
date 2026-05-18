require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ==========================================
// 1. CONFIGURAÇÕES & ARQUIVOS
// ==========================================
const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadSystemInstruction() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
            const config = JSON.parse(data);
            return config.systemInstruction;
        }
    } catch (e) {
        console.error('[Config] Erro ao carregar config.json, usando padrão:', e);
    }
    return `Você é um atendente de Inteligência Artificial prestativo, empático e focado no atendimento ao cliente. Responda sempre em português de forma concisa e amigável.`;
}

function saveSystemInstruction(newInstruction) {
    try {
        const config = { systemInstruction: newInstruction };
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
        console.log('[Config] Prompt atualizado com sucesso em config.json');
        return true;
    } catch (e) {
        console.error('[Config] Erro ao salvar config.json:', e);
        return false;
    }
}

// 2. Chave do Gemini
const apiKey = process.env.GEMINI_API_KEY;
const isGeminiConfigured = apiKey && apiKey !== 'SUA_CHAVE_DO_GEMINI_AQUI';
let genAI = null;

if (!isGeminiConfigured) {
    console.warn('\n⚠️ AVISO: GEMINI_API_KEY não está configurada no .env! O bot funcionará em modo de demonstração (respostas automáticas de demonstração).\n');
} else {
    genAI = new GoogleGenerativeAI(apiKey);
}

// ==========================================
// 3. ESTRUTURA DE DADOS & PERSISTÊNCIA LOCAL
// ==========================================
const DATABASE_PATH = path.join(__dirname, 'crm_database.json');

// conversations: Map (phone -> { phone, name, lastMessage, timestamp, messages: [...], stage, notes, aiEnabled })
const conversations = new Map();
// activeChats: Map (phone -> Gemini ChatSession)
const activeChats = new Map();
// pendingManualMessages: Map (phone -> message body)
const pendingManualMessages = new Map();

// Carregar dados salvos do banco de dados local
function loadDatabase() {
    try {
        if (fs.existsSync(DATABASE_PATH)) {
            const data = fs.readFileSync(DATABASE_PATH, 'utf-8');
            const parsed = JSON.parse(data);
            if (parsed.conversations) {
                conversations.clear();
                Object.keys(parsed.conversations).forEach(phone => {
                    const conv = parsed.conversations[phone];
                    conv.timestamp = new Date(conv.timestamp);
                    if (conv.messages) {
                        conv.messages.forEach(m => {
                            m.timestamp = new Date(m.timestamp);
                        });
                    }
                    // Configura os padrões se não existirem
                    if (conv.stage === undefined) conv.stage = 'lead';
                    if (conv.notes === undefined) conv.notes = '';
                    if (conv.aiEnabled === undefined) conv.aiEnabled = true;
                    
                    conversations.set(phone, conv);
                });
                console.log(`[Database] Banco de dados carregado com ${conversations.size} conversas.`);
            }
        }
    } catch (e) {
        console.error('[Database] Erro ao carregar crm_database.json:', e);
    }
}

// Salvar dados em memória no banco de dados local
function saveDatabase() {
    try {
        const parsed = { conversations: {} };
        conversations.forEach((conv, phone) => {
            parsed.conversations[phone] = conv;
        });
        fs.writeFileSync(DATABASE_PATH, JSON.stringify(parsed, null, 2), 'utf-8');
    } catch (e) {
        console.error('[Database] Erro ao salvar crm_database.json:', e);
    }
}

// Inicializa a persistência local
loadDatabase();

// Estado da Conexão do WhatsApp: 'disconnected' | 'scanning' | 'connected'
let whatsappStatus = 'disconnected';
let currentQrCode = null;

// ==========================================
// 4. INICIALIZAR EXPRESS & SOCKET.IO
// ==========================================
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*'
    }
});

// Servir arquivos estáticos da pasta "public"
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ==========================================
// 5. CONFIGURAR CLIENTE DO WHATSAPP
// ==========================================
console.log('[WhatsApp] Inicializando cliente...');
const client = new Client({
    authStrategy: new LocalAuth(),
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
    },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-extensions',
            '--disable-audio-output',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        ]
    }
});

/**
 * Cria ou recupera a sessão de chat do Gemini para um contato específico
 * Obtém sempre as instruções mais recentes do arquivo config.json
 */
function getOrCreateChatSession(phone) {
    if (!isGeminiConfigured) return null;
    if (!activeChats.has(phone)) {
        console.log(`[Gemini] Criando nova sessão de chat para: ${phone}`);
        const instruction = loadSystemInstruction();
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            systemInstruction: instruction
        });
        const chat = model.startChat({
            history: []
        });
        activeChats.set(phone, chat);
    }
    return activeChats.get(phone);
}

// Evento: QR Code recebido
client.on('qr', (qr) => {
    console.log('[WhatsApp] QR Code recebido.');
    qrcode.generate(qr, { small: true });
    whatsappStatus = 'scanning';
    currentQrCode = qr;
    
    // Notifica todos os navegadores abertos
    io.emit('status-update', { status: whatsappStatus, qr: currentQrCode });
});

// Evento: WhatsApp Pronto
client.on('ready', () => {
    console.log('[WhatsApp] Conectado e pronto!');
    whatsappStatus = 'connected';
    currentQrCode = null;
    io.emit('status-update', { status: whatsappStatus, qr: null });
});

// Evento: Desconectado
client.on('disconnected', (reason) => {
    console.log('[WhatsApp] Desconectado:', reason);
    whatsappStatus = 'disconnected';
    currentQrCode = null;
    io.emit('status-update', { status: whatsappStatus, qr: null });
});

// Evento: Mensagem criada/enviada/recebida no WhatsApp (Captura tudo!)
client.on('message_create', async (message) => {
    try {
        // Ignora mensagens de grupo, newsletter e broadcast
        if (message.from.includes('@g.us') || message.from.includes('@newsletter') || message.from.includes('@broadcast')) return;

        // O id remoto da mensagem é a forma mais rápida e síncrona de agrupar a conversa
        let phone = message.id.remote;

        // Evita processar a própria conta de serviço
        if (phone === client.info?.wid?._serialized) return;

        let name = phone.split('@')[0];

        // Tenta obter contato de forma assíncrona usando o id remoto da conversa (sempre o Lead)
        try {
            const contact = await client.getContactById(phone);
            if (contact) {
                name = contact.name || contact.pushname || name;
                if (contact.number) {
                    phone = `${contact.number}@c.us`;
                }
            }
        } catch(err) {
            console.log('[CRM] Aviso ao obter detalhes do contato:', err.message);
        }

        // Determina quem enviou para salvar corretamente no CRM
        let sender = 'client';
        if (message.fromMe) {
            // Se foi enviado por nós, pode ter sido manual (CRM) ou automático (IA)
            const isManual = pendingManualMessages.has(phone) && pendingManualMessages.get(phone) === message.body;
            if (isManual) {
                sender = 'agent';
                pendingManualMessages.delete(phone); // Consome flag
            } else {
                sender = 'ai';
            }
        }

        // 1. Registrar a mensagem no histórico do CRM (evita duplicidade interna)
        addMessageToHistory(phone, name, sender, message.body);

        // Se a mensagem foi RECEBIDA de um cliente externo, processamos a resposta da IA
        if (!message.fromMe) {
            // Se for comando manual de reset
            if (message.body.trim().toLowerCase() === '!reset') {
                activeChats.delete(phone);
                conversations.delete(phone);
                await message.reply('🔄 Histórico de conversa limpo! Como posso te ajudar agora?');
                io.emit('chat-reset', { phone });
                return;
            }

            // Se a IA estiver pausada para este cliente, ignora a resposta automática
            const conv = conversations.get(phone);
            if (conv && conv.aiEnabled === false) {
                console.log(`[Gemini] IA ignorada para ${phone} devido à intervenção humana ativa.`);
                return;
            }

            // 2. Transmitir ao frontend que o cliente está digitando
            io.emit('typing', { phone, typing: true });

            // 3. Processar mensagem com o Gemini ou resposta demo
            const chat = await message.getChat();
            await chat.sendStateTyping();

            let responseText = '';
            if (isGeminiConfigured) {
                const chatSession = getOrCreateChatSession(phone);
                const result = await chatSession.sendMessage(message.body);
                responseText = result.response.text();
            } else {
                responseText = '⚠️ Olá! Este assistente virtual de WhatsApp está atualmente em modo de testes locais (demonstração).\n\nPara ativar a Inteligência Artificial completa com o Gemini, configure a variável `GEMINI_API_KEY` no arquivo `.env` da aplicação!';
            }

            // 4. Responder no WhatsApp (Isso vai disparar outro evento message_create com fromMe: true que salvará como 'ai')
            await message.reply(responseText);
            await chat.clearState();
        }

    } catch (err) {
        console.error('[Erro] Falha ao processar mensagem (message_create):', err);
    }
});

/**
 * Adiciona uma mensagem ao histórico da conversa e notifica o frontend
 */
function addMessageToHistory(phone, name, sender, body) {
    if (!conversations.has(phone)) {
        conversations.set(phone, {
            phone,
            name,
            lastMessage: '',
            timestamp: new Date(),
            messages: [],
            stage: 'lead',
            notes: '',
            aiEnabled: true
        });
    }

    const conv = conversations.get(phone);
    const msgObj = {
        sender, // 'client' | 'ai' | 'agent'
        body,
        timestamp: new Date()
    };

    conv.messages.push(msgObj);
    conv.lastMessage = body;
    conv.timestamp = msgObj.timestamp;

    // Atualiza a lista de conversas de todos os clientes no frontend
    io.emit('message-update', {
        phone,
        name,
        lastMessage: body,
        timestamp: msgObj.timestamp,
        newMessage: msgObj
    });

    // Persiste no banco de dados local
    saveDatabase();
}

// Helper robusto para obter o chat a partir do número/JID (evita "No LID for user")
async function getChatByPhone(phone) {
    try {
        const chats = await client.getChats();
        for (const c of chats) {
            if (c.id._serialized === phone) {
                return c;
            }
            try {
                const contact = await c.getContact();
                if (contact && contact.number && `${contact.number}@c.us` === phone) {
                    return c;
                }
            } catch (err) {}
        }
        // Fallback: tenta obter diretamente pelo id
        return await client.getChatById(phone);
    } catch (err) {
        console.log(`[CRM] Erro ao buscar chat para ${phone}:`, err.message);
        return null;
    }
}

// Inicializa a conexão do WhatsApp
client.initialize();

// ==========================================
// 6. EVENTOS DO SOCKET.IO (COMUNICACÃO DASHBOARD)
// ==========================================
io.on('connection', (socket) => {
    console.log(`[Socket.io] Novo cliente conectado: ${socket.id}`);

    // Enviar dados iniciais de status e conversas que já temos em memória
    socket.emit('init-data', {
        status: whatsappStatus,
        qr: currentQrCode,
        systemInstruction: loadSystemInstruction(),
        conversations: Array.from(conversations.values())
    });

    // Carrega a lista real de conversas ativas no WhatsApp em segundo plano
    if (whatsappStatus === 'connected') {
        console.log('[Socket.io] Carregando chats reais do WhatsApp em segundo plano...');
        client.getChats().then(async (chats) => {
            const activeChatsOnPhone = chats.filter(c => !c.isGroup && (c.id._serialized.includes('@c.us') || c.id._serialized.includes('@lid'))).slice(0, 15);
            for (const chat of activeChatsOnPhone) {
                let phone = chat.id._serialized;
                try {
                    const contact = await chat.getContact();
                    if (contact && contact.number) {
                        phone = `${contact.number}@c.us`;
                    }
                } catch (err) {
                    console.error('[CRM] Erro ao obter contato para normalização:', err);
                }
                const name = chat.name || phone.split('@')[0];
                
                if (!conversations.has(phone)) {
                    conversations.set(phone, {
                        phone,
                        name,
                        lastMessage: chat.lastMessage ? chat.lastMessage.body : '',
                        timestamp: chat.lastMessage ? new Date(chat.lastMessage.timestamp * 1000) : new Date(),
                        messages: [], // serão carregados sob demanda
                        stage: 'lead',
                        notes: '',
                        aiEnabled: true
                    });
                }
            }
            socket.emit('conversations-loaded', Array.from(conversations.values()));
        }).catch(err => {
            console.error('[Socket.io] Erro ao buscar chats em segundo plano:', err);
        });
    }

    // Evento: Carregar histórico real das últimas 50 mensagens do celular (Sob Demanda)
    socket.on('get-chat-history', async (phone) => {
        try {
            if (whatsappStatus !== 'connected') {
                return socket.emit('error-msg', { message: 'WhatsApp ainda não está conectado. Aguarde...' });
            }
            console.log(`[CRM] Carregando histórico real para o número ${phone}...`);
            const chat = await getChatByPhone(phone);
            if (!chat) {
                throw new Error('Chat não encontrado');
            }
            const msgs = await chat.fetchMessages({ limit: 50 });

            // Mapeia para o formato de visualização do CRM
            const mappedMessages = msgs.map(m => {
                let sender = 'client';
                if (m.fromMe) {
                    // Se estiver no histórico em memória como "agent", mantém. Senão assume "ai"
                    const localConv = conversations.get(phone);
                    const localMsg = localConv ? localConv.messages.find(lm => lm.body === m.body) : null;
                    sender = localMsg ? localMsg.sender : 'ai';
                }
                return {
                    sender,
                    body: m.body,
                    timestamp: new Date(m.timestamp * 1000)
                };
            });

            // Sincroniza a memória local
            if (!conversations.has(phone)) {
                const name = chat.name || phone.split('@')[0];
                conversations.set(phone, {
                    phone,
                    name,
                    lastMessage: chat.lastMessage ? chat.lastMessage.body : '',
                    timestamp: chat.lastMessage ? new Date(chat.lastMessage.timestamp * 1000) : new Date(),
                    messages: [],
                    stage: 'lead',
                    notes: '',
                    aiEnabled: true
                });
            }

            conversations.get(phone).messages = mappedMessages;

            // Retorna apenas para o soquete que pediu
            socket.emit('chat-history', { phone, messages: mappedMessages });

        } catch (e) {
            console.error('[CRM] Erro ao carregar histórico do WhatsApp:', e);
            socket.emit('error-msg', { message: 'Erro ao carregar mensagens históricas do aparelho.' });
        }
    });

    // Evento: Enviar mensagem manual pelo CRM (Intervenção Humana)
    socket.on('send-manual-message', async (data) => {
        const { phone, body } = data;
        if (!phone || !body) return;

        try {
            if (whatsappStatus !== 'connected') {
                return socket.emit('error-msg', { message: 'WhatsApp desconectado. Aguarde a conexão.' });
            }
            console.log(`[CRM] Enviando mensagem manual para ${phone}: "${body}"`);

            // Salva a mensagem no flag pendente antes de enviar para sabermos que foi manual no message_create
            pendingManualMessages.set(phone, body);

            // Obtém o chat de forma robusta e envia a mensagem por ele
            const chat = await getChatByPhone(phone);
            if (chat) {
                await chat.sendMessage(body);
            } else {
                throw new Error('Não foi possível encontrar o chat correspondente para enviar a mensagem.');
            }

            // Pausa a IA automaticamente para que ela não interrompa a conversa humana
            if (conversations.has(phone)) {
                conversations.get(phone).aiEnabled = false;
                io.emit('ai-status-change', { phone, aiEnabled: false });
            }

            // Sincroniza a IA alimentando o histórico do Gemini também, para que ele saiba o que o humano respondeu
            recreateGeminiHistoryWithAgentResponse(phone);

        } catch (e) {
            console.error('[CRM] Erro ao enviar mensagem manual:', e);
            pendingManualMessages.delete(phone);
            socket.emit('error-msg', { message: 'Erro ao enviar mensagem pelo WhatsApp.' });
        }
    });

    // Evento: Atualizar Prompt/Personalidade da IA
    socket.on('save-prompt', (newInstruction) => {
        const success = saveSystemInstruction(newInstruction);
        if (success) {
            // Limpa as sessões ativas do Gemini para que carreguem as novas instruções
            activeChats.clear();
            console.log('[Gemini] Sessões de chat limpas para aplicar novas instruções do sistema.');
            io.emit('prompt-updated', { systemInstruction: newInstruction });
        } else {
            socket.emit('error-msg', { message: 'Erro ao salvar novas instruções.' });
        }
    });

    // Evento: Resetar conversa de um cliente
    socket.on('reset-client-chat', (phone) => {
        if (phone) {
            activeChats.delete(phone);
            conversations.delete(phone);
            saveDatabase(); // Salva a deleção
            console.log(`[CRM] Conversa com o cliente ${phone} foi resetada.`);
            io.emit('chat-reset', { phone });
        }
    });

    // Evento: Alternar status da IA do cliente (Ativa/Pausada)
    socket.on('toggle-ai', (data) => {
        const { phone, enabled } = data;
        if (!phone) return;

        if (conversations.has(phone)) {
            conversations.get(phone).aiEnabled = enabled;
            saveDatabase(); // Salva estado da IA
            io.emit('ai-status-change', { phone, aiEnabled: enabled });
            console.log(`[CRM] Status da IA para ${phone} alterado para: ${enabled ? 'ATIVA' : 'PAUSADA'}`);
        }
    });

    // Evento: Atualizar notas customizadas do cliente
    socket.on('update-client-notes', (data) => {
        const { phone, notes } = data;
        if (!phone) return;

        if (conversations.has(phone)) {
            conversations.get(phone).notes = notes;
            saveDatabase(); // Salva notas persistentes
            io.emit('client-notes-updated', { phone, notes });
            console.log(`[CRM] Notas atualizadas para o cliente ${phone}.`);
        }
    });

    // Evento: Atualizar etapa no funil de vendas (Kanban)
    socket.on('update-client-stage', (data) => {
        const { phone, stage } = data;
        if (!phone || !stage) return;

        if (conversations.has(phone)) {
            conversations.get(phone).stage = stage;
            saveDatabase(); // Salva etapa no Kanban
            io.emit('client-stage-updated', { phone, stage });
            console.log(`[CRM] Cliente ${phone} movido para a etapa Kanban: ${stage}`);
        }
    });
});

/**
 * Recria o histórico de conversa do Gemini incluindo a resposta manual enviada pelo CRM
 * Isso evita que o Gemini fique confuso ou repita respostas
 */
function recreateGeminiHistoryWithAgentResponse(phone) {
    if (!isGeminiConfigured) return;
    const conv = conversations.get(phone);
    if (!conv) return;

    activeChats.delete(phone); // Remove a sessão antiga

    // Mapeia o histórico mantido no CRM para o formato aceito pelo Gemini SDK
    // Papéis aceitos pelo Gemini: 'user' e 'model'
    // 'client' vira 'user', 'ai' e 'agent' viram 'model'
    const geminiHistory = [];
    
    // Mapeia até as últimas 20 mensagens para manter a conversa fluida
    const recentMessages = conv.messages.slice(-20);
    
    for (const msg of recentMessages) {
        const role = msg.sender === 'client' ? 'user' : 'model';
        
        // Agrupa mensagens consecutivas do mesmo papel (Gemini exige alternância perfeita)
        if (geminiHistory.length > 0 && geminiHistory[geminiHistory.length - 1].role === role) {
            geminiHistory[geminiHistory.length - 1].parts[0].text += `\n${msg.body}`;
        } else {
            geminiHistory.push({
                role: role,
                parts: [{ text: msg.body }]
            });
        }
    }

    // O Gemini exige que a primeira mensagem no histórico seja sempre do papel 'user'
    while (geminiHistory.length > 0 && geminiHistory[0].role !== 'user') {
        geminiHistory.shift();
    }

    // Se o último elemento for do papel 'model' (que é a resposta do agente), o Gemini vai exigir 
    // que o próximo input seja do 'user'. Recriamos a sessão com esse histórico injetado.
    try {
        const instruction = loadSystemInstruction();
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            systemInstruction: instruction
        });
        const chat = model.startChat({
            history: geminiHistory
        });
        activeChats.set(phone, chat);
        console.log(`[Gemini] Histórico sincronizado com sucesso para ${phone}.`);
    } catch (e) {
        console.error('[Gemini] Erro ao sincronizar histórico com mensagens manuais:', e);
    }
}

// ==========================================
// 7. INICIAR SERVIDOR HTTP
// ==========================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 CRM Dashboard Online!`);
    console.log(`👉 Acesse no navegador: http://localhost:${PORT}`);
    console.log(`======================================================\n`);
});
