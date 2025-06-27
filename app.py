import os
import json
import sqlite3
import smtplib
from datetime import datetime
from flask import Flask, request, jsonify, g, send_from_directory
from flask_cors import CORS
import cohere
from email.mime.text import MIMEText

app = Flask(__name__)
CORS(app)
app.config['DATABASE'] = 'leads.db'

# --- Cohere Init ---
cohere_api_key = os.environ.get('COHERE_API_KEY')
co = cohere.Client(cohere_api_key) if cohere_api_key else None

# --- Tenants ---
TENANTS_FILE = 'tenants.json'

def load_tenants():
    try:
        with open(TENANTS_FILE) as f:
            return json.load(f)
    except FileNotFoundError:
        return {"tenants": {}}

def save_tenants(tenants):
    with open(TENANTS_FILE, 'w') as f:
        json.dump(tenants, f, indent=2)

# --- Database ---
def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(app.config['DATABASE'])
        g.db.row_factory = sqlite3.Row
        g.db.execute('''
            CREATE TABLE IF NOT EXISTS leads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                phone TEXT,
                message TEXT NOT NULL,
                score INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
    return g.db

@app.teardown_appcontext
def close_db(error):
    if hasattr(g, 'db'):
        g.db.close()

# --- Email Setup ---
SMTP_SERVER = os.environ.get('SMTP_SERVER', 'smtp.gmail.com')
SMTP_PORT = int(os.environ.get('SMTP_PORT', 587))
SMTP_USER = os.environ.get('SMTP_USER')
SMTP_PASSWORD = os.environ.get('SMTP_PASSWORD')

# --- Serve client.js ---
@app.route('/client.js')
def serve_client():
    return send_from_directory('.', 'client.js')

# --- API ROUTES ---
@app.route('/bot_status')
def bot_status():
    tenant_id = request.args.get('tenant_id')
    if not tenant_id:
        return jsonify({"error": "Missing tenant_id"}), 400
    
    tenants = load_tenants()
    tenant = tenants['tenants'].get(tenant_id)

    if not tenant:
        return jsonify({"status": "inactive", "message": "Tenant not registered"})
    
    if tenant.get('active'):
        return jsonify({"status": "active"})
    
    return jsonify({"status": "inactive", "message": "Subscription expired"})

@app.route('/chat_message', methods=['POST'])
def chat_message():
    data = request.json
    tenant_id = data.get('tenant_id')
    message = data.get('message', '').strip()

    if not tenant_id or not message:
        return jsonify({"error": "Missing required fields"}), 400

    tenants = load_tenants()
    tenant = tenants['tenants'].get(tenant_id)

    if not tenant or not tenant.get('active'):
        return jsonify({"reply": "Our chat service is currently unavailable. Please contact us directly."})

    context = f"""
    You are a sales assistant for: {tenant.get('business_name', 'a business')}
    Business Type: {tenant.get('business_type', 'Not specified')}
    Key Services: {tenant.get('key_services', 'Not specified')}
    Target Audience: {tenant.get('target_audience', 'General audience')}

    Conversation Guidelines:
    1. Be friendly but professional
    2. Qualify leads by understanding their needs
    3. For high-intent users, collect contact information
    4. Keep responses under 2 sentences
    """

    ai_reply = "Thanks for your message! How can I assist you today?"
    next_step = "continue"

    try:
        response = co.chat(message=message, model="command", temperature=0.7, preamble=context)
        ai_reply = response.text

        if detect_high_intent(message):
            ai_reply = "Great! To help you quickly, could you please share your name and email address?"
            next_step = "collect_info"

    except Exception as e:
        print(f"Cohere error: {str(e)}")

    return jsonify({"reply": ai_reply, "next_step": next_step})

@app.route('/capture_lead', methods=['POST'])
def capture_lead():
    data = request.json
    tenant_id = data.get('tenant_id')
    name = data.get('name', '').strip()
    email = data.get('email', '').strip()
    phone = data.get('phone', '').strip()
    message = data.get('message', '').strip()

    if not tenant_id or not name or not email or not message:
        return jsonify({"error": "Missing required fields"}), 400

    tenants = load_tenants()
    tenant = tenants['tenants'].get(tenant_id)

    if not tenant or not tenant.get('active'):
        return jsonify({"error": "Tenant not active"}), 400

    score = calculate_lead_score(message, name, email, phone)
    
    db = get_db()
    db.execute(
        "INSERT INTO leads (tenant_id, name, email, phone, message, score) VALUES (?, ?, ?, ?, ?, ?)",
        (tenant_id, name, email, phone, message, score)
    )
    db.commit()

    send_lead_email(tenant, {
        "name": name,
        "email": email,
        "phone": phone,
        "message": message,
        "score": score
    })

    return jsonify({"status": "success", "message": "We'll contact you shortly!"})

# --- Logic Helpers ---
def detect_high_intent(message):
    phrases = [
        'buy now', 'sign up', 'contact sales', 'schedule demo', 'get started',
        'purchase', 'order', 'talk to sales', 'interested in buying', 'ready to buy'
    ]
    return any(p in message.lower() for p in phrases)

def calculate_lead_score(message, name, email, phone):
    score = 0
    if len(message) > 30: score += 15
    if 'price' in message.lower(): score += 20
    if 'buy' in message.lower() or 'purchase' in message.lower(): score += 30
    if name: score += 10
    if email: score += 15
    if phone: score += 20
    if detect_high_intent(message): score += 40
    return min(score, 100)

def send_lead_email(tenant, lead):
    if not SMTP_USER or not SMTP_PASSWORD:
        print("Email not configured. Skipping email.")
        return

    try:
        msg = MIMEText(f"""
New Lead from your website:

Name: {lead['name']}
Email: {lead['email']}
Phone: {lead.get('phone', 'N/A')}
Score: {lead['score']}/100
Message: {lead['message']}

Context:
{tenant.get('business_info', 'No context provided')}
        """)
        msg['Subject'] = f"New Lead: {lead['name']} (Score: {lead['score']}/100)"
        msg['From'] = SMTP_USER
        msg['To'] = tenant['owner_email']

        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(msg)

        print(f"Email sent to {tenant['owner_email']}")

    except Exception as e:
        print("Email sending failed:", e)

# --- Start Server ---
if __name__ == '__main__':
    load_tenants()  # Ensures tenants.json exists
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
