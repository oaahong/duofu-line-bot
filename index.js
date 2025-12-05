// 多扶學堂 & 多扶接送 LINE Bot 核心程式

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



// Webhook 入口
app.post('/webhook', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error('Handle event error:', err);
      res.status(500).end();
    });
});

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

  // 接送諮詢流程
  SHUTTLE_ASK_DATE: 'SHUTTLE_ASK_DATE',
  SHUTTLE_ASK_LOCATIONS: 'SHUTTLE_ASK_LOCATIONS',
  SHUTTLE_ASK_DETAILS: 'SHUTTLE_ASK_DETAILS',

  // 租車諮詢流程（先預留）
  RENTAL_ASK_DATE: 'RENTAL_ASK_DATE',
  RENTAL_ASK_DRIVER: 'RENTAL_ASK_DRIVER',
  RENTAL_ASK_CONTACT: 'RENTAL_ASK_CONTACT',
};

// 模式切換
const MODES = {
  AI: 'AI',
  HUMAN: 'HUMAN',
};

// --- 3. 核心邏輯處理 ---
async function handleEvent(event) {
  if (event.type !== 'message' && event.type !== 'postback') {
    return Promise.resolve(null);
  }

  const userId = event.source.userId;
  let session =
    userSessions.get(userId) || {
      state: STATES.IDLE,
      mode: MODES.AI,
      data: {},
      tags: [],
    };

  // 處理 Postback (如果之後有用到 Rich Menu 的 postback)
  if (event.type === 'postback') {
    const data = event.postback.data;

    if (data === 'action=course') {
      session.state = STATES.COURSE_ASK_ROLE;
      session.tags.push('學堂-潛在學員');
      userSessions.set(userId, session);
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '【多扶學堂 課程報名】\n很高興您對課程有興趣！請問您是幫誰詢問呢？',
      });
    }

    if (data === 'action=shuttle') {
      session.state = STATES.SHUTTLE_ASK_DATE;
      session.tags.push('接送-照顧者');
      session.data = { type: '接送諮詢' };
      userSessions.set(userId, session);
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '【多扶接送 預約諮詢】\n請告訴我您預計用車的「日期」與「出發時間」？\n(例如：下週三早上9點)',
      });
    }

    if (data === 'action=rental') {
      session.state = STATES.RENTAL_ASK_DATE;
      session.tags.push('租車-需求者');
      session.data = { type: '租車諮詢' };
      userSessions.set(userId, session);
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '【無障礙租車 諮詢】\n請問您預計租借的日期區間是？\n(例如：12/20 到 12/22)',
      });
    }

    if (data === 'action=human') {
      session.mode = MODES.HUMAN;
      userSessions.set(userId, session);
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text:
          '【切換為真人模式】\n目前客服人員會儘快查看您的訊息。\n若有急事請撥打 02-8663-xxxx。\n(輸入「AI模式」可切換回自動回覆)',
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
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '已切換回 AI 智能助理模式，有什麼我可以幫您的嗎？',
      });
    }

    if (text === '真人模式') {
      session.mode = MODES.HUMAN;
      userSessions.set(userId, session);
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '已切換為真人模式，請稍候客服回應。',
      });
    }

    // 2. 流程狀態機
    switch (session.state) {
      // --- 課程預約流程 ---
      case STATES.COURSE_ASK_ROLE:
        session.data.role = text;
        session.state = STATES.COURSE_ASK_NAME;
        userSessions.set(userId, session);
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '了解。請問怎麼稱呼您？',
        });

      case STATES.COURSE_ASK_NAME:
        session.data.name = text;
        session.state = STATES.COURSE_ASK_PHONE;
        userSessions.set(userId, session);
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: `好的 ${text}，請留下您的聯絡電話，方便我們聯繫確認。`,
        });

      case STATES.COURSE_ASK_PHONE:
        session.data.phone = text;
        session.state = STATES.COURSE_ASK_TYPE;
        userSessions.set(userId, session);
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '請問您感興趣的課程類型是？(例如：認知訓練、體適能運動、藝術創作…)',
        });

      case STATES.COURSE_ASK_TYPE:
        session.data.courseType = text;
        session.state = STATES.IDLE;

        await saveToGoogleSheet('課程預約', session.data);
        await sendEmailNotification('新課程預約', session.data);

        userSessions.set(userId, session);
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text:
            `感謝您！資料已收到。\n` +
            `我們記下了：\n` +
            `姓名：${session.data.name}\n` +
            `電話：${session.data.phone}\n` +
            `興趣：${session.data.courseType}\n\n` +
            `專員會儘快與您聯繫安排試聽或說明！`,
        });

      // --- 接送諮詢流程 ---
      case STATES.SHUTTLE_ASK_DATE:
        session.data.date = text;
        session.state = STATES.SHUTTLE_ASK_LOCATIONS;
        userSessions.set(userId, session);
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text:
            '好的，請問「起點」和「終點」大概在哪裡？\n(例如：從木柵路三段到台大醫院)',
        });

      case STATES.SHUTTLE_ASK_LOCATIONS:
        session.data.locations = text;
        session.state = STATES.SHUTTLE_ASK_DETAILS;
        userSessions.set(userId, session);
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '請問搭乘人數？是否有輪椅、助行器等需求？',
        });

      case STATES.SHUTTLE_ASK_DETAILS:
        session.data.details = text;
        session.state = STATES.IDLE;

        const estimatePrice = '800 - 1200';

        await saveToGoogleSheet('接送諮詢', session.data);
        await sendEmailNotification('新接送需求', session.data);

        userSessions.set(userId, session);
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text:
            `收到您的需求！\n` +
            `根據距離，單趟預估費用約在 $${estimatePrice} 元之間。\n\n` +
            `客服專員會稍後致電給您確認精確報價與車輛狀況。`,
        });

      // --- 閒置狀態 ---
      case STATES.IDLE:
        if (session.mode === MODES.HUMAN) {
          // 真人模式就不自動回覆
          return Promise.resolve(null);
        }

        // 關鍵字觸發流程
        if (text.includes('上課') || text.includes('課程')) {
          session.state = STATES.COURSE_ASK_ROLE;
          session.tags.push('學堂-潛在學員');
          userSessions.set(userId, session);
          return client.replyMessage(event.replyToken, {
            type: 'text',
            text:
              '想了解課程嗎？請問您是幫誰詢問呢？\n（可直接回覆：我是照顧者 / 長輩本人 / 社工）',
          });
        }

        if (text.includes('接送') || text.includes('訂車')) {
          session.state = STATES.SHUTTLE_ASK_DATE;
          session.tags.push('接送-照顧者');
          session.data = { type: '接送諮詢' };
          userSessions.set(userId, session);
          return client.replyMessage(event.replyToken, {
            type: 'text',
            text: '沒問題，請問您想預約什麼時候的接送？',
          });
        }

        // 其他文字 → 丟給 OpenAI 當 AI 客服
        const aiResponse = await callOpenAI(text);
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: aiResponse,
        });

      default:
        // 萬一有奇怪狀態，就重置
        session.state = STATES.IDLE;
        userSessions.set(userId, session);
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '我有點當機了，麻煩再說一次您的需求～',
        });
    }
  }

  return Promise.resolve(null);
}

// --- 4. OpenAI 串接 ---
async function callOpenAI(userMessage) {
  if (!process.env.OPENAI_API_KEY) {
    return '（系統提示：請先設定 OPENAI_API_KEY 才能啟動 AI 聊天）';
  }

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content:
              '你現在是「多扶學堂」與「多扶接送」的溫暖客服助理。' +
              '1. 多扶學堂提供熟齡課程（文山區為主），包含認知、體適能、喜劇工作坊。' +
              '2. 多扶接送提供無障礙接送服務。' +
              '3. 若問到醫療建議，請委婉告知我們非醫療機構，建議就醫或詢問專業人員。' +
              '4. 若問到具體價格，請給合理範圍，並引導對方留下聯絡方式由專員回電。' +
              '5. 語氣要親切、像跟家人說話，用繁體中文回答。',
          },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 300,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data.choices[0].message.content.trim();
  } catch (error) {
    console.error('OpenAI Error:', error.response?.data || error.message);
    return '抱歉，我現在腦袋有點打結，請稍後再試，或聯絡真人客服。';
  }
}

// --- 5. 模擬外部系統整合 ---
async function saveToGoogleSheet(type, data) {
  console.log(`[Google Sheet] 寫入資料 (${type}):`, JSON.stringify(data));
}

async function sendEmailNotification(subject, data) {
  console.log(`[Email] 寄送通知 (${subject}):`, JSON.stringify(data));
}

// --- 6. 啟動伺服器 ---
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`LINE bot listening on ${port}`);
});
