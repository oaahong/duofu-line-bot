**
 * 多扶學堂 & 多扶接送 LINE Bot 核心程式
 * 功能包含：
 * 1. AI 智能客服 (OpenAI 串接)
 * 2. 課程預約流程
 * 3. 接送/租車諮詢流程
 * 4. 資料寫入 Google Sheet (模擬結構)
 * 5. Email 通知 (模擬結構)
 */

require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const axios = require('axios');

// --- 1. 設定與環境變數 ---
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.Client(config);
const app = express();

// 簡單的內存資料庫，用來記錄使用者的對話狀態
// 在正式環境建議使用 Redis 或資料庫
const userSessions = new Map();

// --- 2. 狀態定義 ---
const STATES = {
  IDLE: 'IDLE', // 閒置狀態 (AI 模式或真人模式)
  
  // 課程預約流程
  COURSE_ASK_ROLE: 'COURSE_ASK_ROLE',
  COURSE_ASK_NAME: 'COURSE_ASK_NAME',
  COURSE_ASK_PHONE: 'COURSE_ASK_PHONE',
  COURSE_ASK_TYPE: 'COURSE_ASK_TYPE',
  COURSE_ASK_TIME: 'COURSE_ASK_TIME',
  
  // 接送諮詢流程
  SHUTTLE_ASK_DATE: 'SHUTTLE_ASK_DATE',
  SHUTTLE_ASK_LOCATIONS: 'SHUTTLE_ASK_LOCATIONS',
  SHUTTLE_ASK_DETAILS: 'SHUTTLE_ASK_DETAILS', // 人數、輪椅等
  SHUTTLE_ASK_CONTACT: 'SHUTTLE_ASK_CONTACT',

  // 租車諮詢流程
  RENTAL_ASK_DATE: 'RENTAL_ASK_DATE',
  RENTAL_ASK_DRIVER: 'RENTAL_ASK_DRIVER',
  RENTAL_ASK_CONTACT: 'RENTAL_ASK_CONTACT',
};

// 模式切換
const MODES = {
  AI: 'AI',
  HUMAN: 'HUMAN'
};

// --- 3. Webhook 入口 ---
app.post('/webhook', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

// --- 4. 核心邏輯處理 ---
async function handleEvent(event) {
  if (event.type !== 'message' && event.type !== 'postback') {
    return Promise.resolve(null);
  }

  const userId = event.source.userId;
  let session = userSessions.get(userId) || { 
    state: STATES.IDLE, 
    mode: MODES.AI, 
    data: {},
    tags: [] 
  };

  // 處理 Postback (點擊 Rich Menu 或按鈕)
  if (event.type === 'postback') {
    const data = event.postback.data;
    if (data === 'action=course') {
      session.state = STATES.COURSE_ASK_ROLE;
      session.tags.push('學堂-潛在學員');
      userSessions.set(userId, session);
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '【多扶學堂 課程報名】\n很高興您對課程有興趣！請問您是幫誰詢問呢？',
        quickReply: {
          items: [
            { type: 'action', action: { type: 'message', label: '我是照顧者', text: '我是照顧者' } },
            { type: 'action', action: { type: 'message', label: '長輩本人', text: '我是長輩本人' } },
            { type: 'action', action: { type: 'message', label: '社工/其他', text: '社工/其他' } }
          ]
        }
      });
    } else if (data === 'action=shuttle') {
      session.state = STATES.SHUTTLE_ASK_DATE;
      session.tags.push('接送-照顧者');
      session.data = { type: '接送諮詢' }; // 初始化資料
      userSessions.set(userId, session);
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '【多扶接送 預約諮詢】\n請告訴我您預計用車的「日期」與「出發時間」？\n(例如：下週三早上9點)'
      });
    } else if (data === 'action=rental') {
      session.state = STATES.RENTAL_ASK_DATE;
      session.tags.push('租車-需求者');
      session.data = { type: '租車諮詢' };
      userSessions.set(userId, session);
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '【無障礙租車 諮詢】\n請問您預計租借的日期區間是？\n(例如：12/20 到 12/22)'
      });
    } else if (data === 'action=human') {
      session.mode = MODES.HUMAN;
      userSessions.set(userId, session);
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '【切換為真人模式】\n目前客服人員會儘快查看您的訊息。\n若有急事請撥打 02-8663-xxxx。\n(輸入「AI模式」可切換回自動回覆)'
      });
    }
  }

  // 處理文字訊息
  if (event.type === 'message' && event.message.type === 'text') {
    const text = event.message.text.trim();

    // 1. 全域指令檢查
    if (text === 'AI模式') {
      session.mode = MODES.AI;
      session.state = STATES.IDLE; // 重置流程
      userSessions.set(userId, session);
      return client.replyMessage(event.replyToken, { type: 'text', text: '已切換回 AI 智能助理模式，有什麼我可以幫您的嗎？' });
    }
    if (text === '真人模式') {
      session.mode = MODES.HUMAN;
      userSessions.set(userId, session);
      return client.replyMessage(event.replyToken, { type: 'text', text: '已切換為真人模式，請稍候客服回應。' });
    }

    // 2. 流程狀態機 (State Machine)
    switch (session.state) {
      
      // --- 課程預約流程 ---
      case STATES.COURSE_ASK_ROLE:
        session.data.role = text;
        session.state = STATES.COURSE_ASK_NAME;
        userSessions.set(userId, session);
        return client.replyMessage(event.replyToken, { type: 'text', text: '了解。請問怎麼稱呼您？' });

      case STATES.COURSE_ASK_NAME:
        session.data.name = text;
        session.state = STATES.COURSE_ASK_PHONE;
        userSessions.set(userId, session);
        return client.replyMessage(event.replyToken, { type: 'text', text: '好的 ' + text + '，請留下您的聯絡電話，方便我們聯繫確認。' });

      case STATES.COURSE_ASK_PHONE:
        session.data.phone = text;
        session.state = STATES.COURSE_ASK_TYPE;
        userSessions.set(userId, session);
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '請問您感興趣的課程類型是？(可直接輸入，如：認知課程、運動、藝術)',
          quickReply: {
            items: [
              { type: 'action', action: { type: 'message', label: '認知訓練', text: '認知訓練' } },
              { type: 'action', action: { type: 'message', label: '體適能運動', text: '體適能運動' } },
              { type: 'action', action: { type: 'message', label: '藝術創作', text: '藝術創作' } }
            ]
          }
        });

      case STATES.COURSE_ASK_TYPE:
        session.data.courseType = text;
        session.state = STATES.IDLE; // 流程結束
        // 儲存資料並通知
        await saveToGoogleSheet('課程預約', session.data);
        await sendEmailNotification('新課程預約', session.data);
        
        userSessions.set(userId, session);
        return client.replyMessage(event.replyToken, { 
          type: 'text', 
          text: `感謝您！資料已收到。\n我們記下了：\n姓名：${session.data.name}\n電話：${session.data.phone}\n興趣：${session.data.courseType}\n\n專員會儘快與您聯繫安排試聽或說明！` 
        });

      // --- 接送諮詢流程 (簡化版) ---
      case STATES.SHUTTLE_ASK_DATE:
        session.data.date = text;
        session.state = STATES.SHUTTLE_ASK_LOCATIONS;
        userSessions.set(userId, session);
        return client.replyMessage(event.replyToken, { type: 'text', text: '好的，請問「起點」和「終點」大概在哪裡？(例如：從木柵路三段到台大醫院)' });

      case STATES.SHUTTLE_ASK_LOCATIONS:
        session.data.locations = text;
        session.state = STATES.SHUTTLE_ASK_DETAILS;
        userSessions.set(userId, session);
        return client.replyMessage(event.replyToken, { type: 'text', text: '請問搭乘人數？是否有輪椅需求？' });

      case STATES.SHUTTLE_ASK_DETAILS:
        session.data.details = text;
        session.state = STATES.IDLE;
        
        // 估價邏輯 (Mock)
        const estimatePrice = "800 - 1200"; 
        
        await saveToGoogleSheet('接送諮詢', session.data);
        await sendEmailNotification('新接送需求', session.data);
        
        userSessions.set(userId, session);
        return client.replyMessage(event.replyToken, { 
          type: 'text', 
          text: `收到您的需求！\n根據距離，單趟預估費用約在 $${estimatePrice} 元之間。\n\n客服專員會稍後致電給您確認精確報價與車輛狀況。` 
        });

      // --- 租車流程省略，邏輯同上 ---
      
      // --- 閒置狀態 (IDLE) ---
      case STATES.IDLE:
        // 如果是真人模式，不回覆或只回覆簡單罐頭
        if (session.mode === MODES.HUMAN) {
          // 可選擇不回覆，或回覆等待訊息
          return Promise.resolve(null);
        }

        // 關鍵字觸發流程 (若使用者沒按按鈕直接打字)
        if (text.includes('上課') || text.includes('課程')) {
          session.state = STATES.COURSE_ASK_ROLE;
          session.tags.push('學堂-潛在學員');
          userSessions.set(userId, session);
          return client.replyMessage(event.replyToken, { type: 'text', text: '想了解課程嗎？請問您是幫誰詢問呢？(照顧者/長輩本人)' });
        }
        
        if (text.includes('接送') || text.includes('訂車')) {
          session.state = STATES.SHUTTLE_ASK_DATE;
          session.tags.push('接送-照顧者');
          session.data = { type: '接送諮詢' };
          userSessions.set(userId, session);
          return client.replyMessage(event.replyToken, { type: 'text', text: '沒問題，請問您想預約什麼時候的接送？' });
        }

        // --- AI 處理 ---
        // 這裡呼叫 OpenAI
        const aiResponse = await callOpenAI(text);
        return client.replyMessage(event.replyToken, { type: 'text', text: aiResponse });
    }
  }
}

// --- 5. OpenAI 串接 ---
async function callOpenAI(userMessage) {
  if (!process.env.OPENAI_API_KEY) return "（系統提示：請先設定 OpenAI API Key 才能啟動 AI 聊天）";

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo', // 或 gpt-4
        messages: [
          {
            role: 'system',
            content: `你現在是「多扶學堂」與「多扶接送」的溫暖客服助理。
            1. 多扶學堂提供熟齡課程（文山區為主），包含認知、體適能、喜劇工作坊。
            2. 多扶接送提供無障礙接送。
            3. 若問到醫療建議，請委婉告知我們非醫療機構。
            4. 若問到具體價格，請給範圍並引導按選單預約諮詢。
            5. 語氣要親切、像跟家人說話。`
          },
          { role: 'user', content: userMessage }
        ],
        max_tokens: 300
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data.choices[0].message.content.trim();
  } catch (error) {
    console.error('OpenAI Error:', error);
    return '抱歉，我現在腦袋有點打結，請稍後再試，或聯絡真人客服。';
  }
}

// --- 6. 模擬外部系統整合 ---

// 模擬：寫入 Google Sheet
// 實際運作需設定 Google Service Account Credentials
async function saveToGoogleSheet(type, data) {
  console.log(`[Google Sheet] 寫入資料 (${type}):`, JSON.stringify(data));
  // 實作提示：
  // 1. const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);
  // 2. await doc.useServiceAccountAuth({ ... });
  // 3. await doc.loadInfo();
  // 4. const sheet = doc.sheetsByIndex[0];
  // 5. await sheet.addRow({ ...data, time: new Date() });
}

// 模擬：寄送 Email
async function sendEmailNotification(subject, data) {
  console.log(`[Email] 寄送通知 (${subject}):`, JSON.stringify(data));
  // 實作提示：
  // 使用 nodemailer 設定 Gmail SMTP 或其他郵件服務
}

// --- 啟動伺服器 ---
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`listening on ${port}`);
});
