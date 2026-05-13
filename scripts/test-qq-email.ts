/**
 * 测试QQ邮箱SMTP配置
 * 使用方法: pnpm tsx scripts/test-qq-email.ts
 */

import "dotenv/config";
import nodemailer from "nodemailer";

async function testQQEmail() {
  // QQ邮箱SMTP配置
  const smtpConfig = {
    host: "smtp.qq.com",
    port: 465, // 也可以使用 587 (TLS)
    secure: true, // 465端口使用SSL
    auth: {
      user: "1204378104@qq.com",
      pass: "vtgsxvhxpxvlfeie", // 授权码
    },
  };

  const targetEmail = "wujing14@huawei.com";

  console.log("正在测试QQ邮箱SMTP配置...");
  console.log("SMTP服务器:", smtpConfig.host);
  console.log("端口:", smtpConfig.port);
  console.log("发件人:", smtpConfig.auth.user);
  console.log("收件人:", targetEmail);
  console.log("");

  try {
    // 创建transporter
    const transporter = nodemailer.createTransport(smtpConfig);

    // 验证连接
    console.log("正在验证SMTP连接...");
    await transporter.verify();
    console.log("✅ SMTP连接验证成功！\n");

    // 发送测试邮件
    console.log("正在发送测试邮件...");
    const info = await transporter.sendMail({
      from: `"灵感平台" <${smtpConfig.auth.user}>`, // QQ邮箱要求from必须与user一致
      to: targetEmail,
      subject: "【灵感】QQ邮箱SMTP测试邮件",
      text: "这是一封来自灵感平台的测试邮件。如果您收到此邮件，说明QQ邮箱SMTP配置正确。",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #CF0A2C;">灵感 - QQ邮箱SMTP测试邮件</h2>
          <p>您好，</p>
          <p>这是一封来自灵感平台的测试邮件。</p>
          <p>如果您收到此邮件，说明QQ邮箱SMTP配置正确，邮件发送功能正常工作。</p>
          <p style="color: #666; font-size: 12px; margin-top: 30px;">
            此邮件由系统自动发送，请勿回复。
          </p>
        </div>
      `,
    });

    console.log("✅ 测试邮件发送成功！");
    console.log("邮件ID:", info.messageId);
    console.log("响应:", info.response);
    console.log("");
    console.log("请检查收件箱（包括垃圾邮件文件夹）");

    // 关闭连接
    transporter.close();
  } catch (error: any) {
    console.error("❌ 发送失败:");
    console.error("错误信息:", error.message);
    if (error.code) {
      console.error("错误代码:", error.code);
    }
    if (error.response) {
      console.error("SMTP响应:", error.response);
    }
    if (error.responseCode) {
      console.error("响应代码:", error.responseCode);
    }
    if (error.command) {
      console.error("失败的命令:", error.command);
    }

    // 如果是465端口失败，尝试587端口
    if (smtpConfig.port === 465) {
      console.log("\n尝试使用587端口（TLS）...");
      try {
        const transporter587 = nodemailer.createTransport({
          host: "smtp.qq.com",
          port: 587,
          secure: false, // 587端口使用TLS
          requireTLS: true,
          auth: {
            user: smtpConfig.auth.user,
            pass: smtpConfig.auth.pass,
          },
          tls: {
            rejectUnauthorized: false,
          },
        });

        await transporter587.verify();
        console.log("✅ 587端口连接验证成功！");

        const info = await transporter587.sendMail({
          from: `"灵感平台" <${smtpConfig.auth.user}>`,
          to: targetEmail,
          subject: "【灵感】QQ邮箱SMTP测试邮件（587端口）",
          text: "这是一封来自灵感平台的测试邮件（使用587端口发送）。",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #CF0A2C;">灵感 - QQ邮箱SMTP测试邮件</h2>
              <p>这是一封使用587端口（TLS）发送的测试邮件。</p>
            </div>
          `,
        });

        console.log("✅ 587端口测试邮件发送成功！");
        console.log("邮件ID:", info.messageId);
        transporter587.close();
      } catch (error587: any) {
        console.error("❌ 587端口也失败:");
        console.error("错误信息:", error587.message);
      }
    }

    process.exit(1);
  }
}

testQQEmail();
