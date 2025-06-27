class LeadBot {
    constructor(tenantId) {
        this.tenantId = tenantId;
        this.apiBase = 'https://your-backend-service-url.com'; // ✅ Replace with deployed URL
        this.isOpen = false;
        this.conversationStage = "welcome";
        this.userInfo = { name: '', email: '', phone: '' };
        this.init();
    }

    async init() {
        const status = await this.fetchStatus();
        if (status.status !== 'active') {
            this.showInactiveMessage(status.message || "Chat service unavailable");
            return;
        }
        this.createUI();
        this.setupEventListeners();
        this.addMessage("Hello! I'm your sales assistant. How can I help you today?", false);
    }

    async fetchStatus() {
        try {
            const response = await fetch(`${this.apiBase}/bot_status?tenant_id=${this.tenantId}`);
            return await response.json();
        } catch (error) {
            console.error("Status check failed:", error);
            return { status: 'inactive', message: 'Service unavailable' };
        }
    }

    createUI() {
        this.chatContainer = document.createElement('div');
        this.chatContainer.id = 'leadbot-container';
        this.chatContainer.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; width: 350px; max-width: 90vw; z-index: 10000;
            font-family: Arial, sans-serif; box-shadow: 0 5px 15px rgba(0,0,0,0.2); border-radius: 12px 12px 0 0;
            overflow: hidden; display: flex; flex-direction: column; transform: translateY(100%);
            transition: transform 0.3s ease;
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            background: #2563eb; color: white; padding: 15px; display: flex;
            justify-content: space-between; align-items: center;
        `;
        header.innerHTML = `
            <div>
                <strong>Sales Assistant</strong>
                <div style="font-size:0.8rem;opacity:0.8">We're here to help!</div>
            </div>
            <button id="leadbot-close" style="background:none;border:none;color:white;cursor:pointer">✕</button>
        `;

        this.chatBody = document.createElement('div');
        this.chatBody.id = 'leadbot-chat';
        this.chatBody.style.cssText = `
            flex-grow: 1; height: 300px; padding: 15px; background: #f9fafb;
            overflow-y: auto; display: flex; flex-direction: column; gap: 10px;
        `;

        this.infoForm = document.createElement('div');
        this.infoForm.id = 'leadbot-info-form';
        this.infoForm.style.cssText = `
            padding: 15px; background: white; border-top: 1px solid #eee; display: none;
        `;
        this.infoForm.innerHTML = `
            <div style="margin-bottom:10px"><strong>Almost done!</strong> Please share your contact details:</div>
            <input type="text" id="leadbot-name" placeholder="Your name" required style="width:100%;padding:10px;margin-bottom:10px;border:1px solid #ddd;border-radius:4px">
            <input type="email" id="leadbot-email" placeholder="Email" required style="width:100%;padding:10px;margin-bottom:10px;border:1px solid #ddd;border-radius:4px">
            <input type="tel" id="leadbot-phone" placeholder="Phone (optional)" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:4px">
            <button id="leadbot-submit" style="width:100%;background:#2563eb;color:white;border:none;padding:12px;border-radius:4px;margin-top:10px;cursor:pointer">Submit Information</button>
        `;

        const inputArea = document.createElement('div');
        inputArea.style.cssText = `
            padding: 10px; background: white; border-top: 1px solid #eee; display: flex; gap: 10px;
        `;
        inputArea.innerHTML = `
            <input type="text" id="leadbot-input" placeholder="Type your message..." style="flex-grow:1;padding:10px;border:1px solid #ddd;border-radius:4px">
            <button id="leadbot-send" style="background:#2563eb;color:white;border:none;padding:10px 15px;border-radius:4px;cursor:pointer">Send</button>
        `;

        this.chatBubble = document.createElement('div');
        this.chatBubble.id = 'leadbot-bubble';
        this.chatBubble.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; width: 60px; height: 60px;
            background: #2563eb; border-radius: 50%; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            box-shadow: 0 4px 8px rgba(0,0,0,0.2); z-index: 10001;
        `;
        this.chatBubble.innerHTML = '💬';

        this.chatContainer.appendChild(header);
        this.chatContainer.appendChild(this.chatBody);
        this.chatContainer.appendChild(this.infoForm);
        this.chatContainer.appendChild(inputArea);
        document.body.appendChild(this.chatBubble);
        document.body.appendChild(this.chatContainer);
    }

    setupEventListeners() {
        this.chatBubble.addEventListener('click', () => this.toggleChat());
        document.getElementById('leadbot-close').addEventListener('click', () => this.toggleChat());
        document.getElementById('leadbot-send').addEventListener('click', () => this.handleSend());
        document.getElementById('leadbot-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleSend();
        });
        document.getElementById('leadbot-submit').addEventListener('click', () => this.handleInfoSubmit());
    }

    toggleChat() {
        this.isOpen = !this.isOpen;
        this.chatContainer.style.transform = this.isOpen ? 'translateY(0)' : 'translateY(100%)';
        if (this.isOpen) document.getElementById('leadbot-input').focus();
    }

    async handleSend() {
        const input = document.getElementById('leadbot-input');
        const message = input.value.trim();
        if (!message) return;

        this.addMessage(message, true);
        input.value = '';
        const loadingMsg = this.addMessage("Thinking...", false);

        try {
            const response = await fetch(`${this.apiBase}/chat_message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenant_id: this.tenantId, message })
            });

            const data = await response.json();
            loadingMsg.textContent = data.reply;
            if (data.next_step === 'collect_info') this.showInfoForm();
        } catch (error) {
            console.error("Message send error:", error);
            loadingMsg.textContent = "Connection issue. Please try again.";
        }
    }

    showInfoForm() {
        document.getElementById('leadbot-info-form').style.display = 'block';
        document.getElementById('leadbot-input').disabled = true;
        this.chatBody.scrollTop = this.chatBody.scrollHeight;
    }

    async handleInfoSubmit() {
        const name = document.getElementById('leadbot-name').value.trim();
        const email = document.getElementById('leadbot-email').value.trim();
        const phone = document.getElementById('leadbot-phone').value.trim();

        if (!name || !email) {
            alert('Please provide your name and email');
            return;
        }

        this.userInfo = { name, email, phone };
        this.addMessage("Submitting your information...", false);

        try {
            const response = await fetch(`${this.apiBase}/capture_lead`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tenant_id: this.tenantId,
                    name,
                    email,
                    phone,
                    message: "User provided contact information"
                })
            });

            const data = await response.json();
            this.addMessage(data.message || "Thank you! We'll contact you shortly.", false);
            document.getElementById('leadbot-info-form').style.display = 'none';
            document.getElementById('leadbot-input').disabled = false;
        } catch (error) {
            console.error("Lead capture error:", error);
            this.addMessage("Failed to submit information. Please try again.", false);
        }
    }

    addMessage(text, isUser) {
        const messageDiv = document.createElement('div');
        messageDiv.style.cssText = `
            align-self: ${isUser ? 'flex-end' : 'flex-start'};
            background: ${isUser ? '#dbeafe' : '#e5e7eb'};
            padding: 10px 15px;
            border-radius: 18px;
            max-width: 80%;
            word-wrap: break-word;
            animation: fadeIn 0.3s ease;
        `;
        messageDiv.textContent = text;
        this.chatBody.appendChild(messageDiv);
        this.chatBody.scrollTop = this.chatBody.scrollHeight;

        if (!document.getElementById('leadbot-styles')) {
            const style = document.createElement('style');
            style.id = 'leadbot-styles';
            style.textContent = `
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `;
            document.head.appendChild(style);
        }

        return messageDiv;
    }

    showInactiveMessage(message) {
        const msgDiv = document.createElement('div');
        msgDiv.style.cssText = `
            position: fixed; bottom: 20px; right: 20px;
            background: #ef4444; color: white;
            padding: 10px 20px; border-radius: 8px;
            z-index: 10000; box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        `;
        msgDiv.textContent = message;
        document.body.appendChild(msgDiv);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const scriptTag = document.querySelector('script[data-tenant]');
    if (scriptTag) {
        const tenantId = scriptTag.getAttribute('data-tenant');
        new LeadBot(tenantId);
    }
});
