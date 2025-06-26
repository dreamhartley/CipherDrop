<template>
  <el-container class="landing-container">
    <el-main class="main-content">
      <el-card class="box-card">
        <template #header>
          <div class="card-header">
            <span>端到端加密传输</span>
            <div class="subtitle">消息和文件仅在客户端可用</div>
          </div>
        </template>
        <div class="action-section">
          <el-button type="primary" size="large" @click="createNewSession" :loading="isCreating">创建</el-button>
          <el-divider>或</el-divider>
          <div class="join-section">
            <el-input
              v-model="inputCode"
              placeholder="输入匹配码加入"
              size="large"
              maxlength="6"
              @input="inputCode = inputCode.toUpperCase()"
              @keyup.enter="joinSession"
            />
            <el-button size="large" @click="joinSession" :disabled="!inputCode">加入</el-button>
          </div>
        </div>
      </el-card>
    </el-main>
    <el-footer class="footer">
      <p>Copyright © 2025 CipherDrop</p>
    </el-footer>
  </el-container>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import api from '../services/api';
import { createSessionToken } from '../router';

const router = useRouter();
const inputCode = ref('');
const isCreating = ref(false);

async function createNewSession() {
  isCreating.value = true;
  try {
    const { code } = await api.getMatchCode();
    // 创建会话令牌并跳转
    const sessionToken = createSessionToken(code);
    router.push(`/room/${sessionToken}`);
  } catch (error) {
    // 检查是否是会话数量限制错误
    if (error.response && error.response.status === 429) {
      const message = error.response.data.message || '服务器繁忙，请稍后再试';
      ElMessage.error(message);
    } else {
      ElMessage.error('创建会话失败，请重试');
    }
    console.error("Failed to create new session:", error);
  } finally {
    isCreating.value = false;
  }
}

function joinSession() {
  const code = inputCode.value.trim().toUpperCase();
  if (!code) {
    ElMessage.warning('请输入匹配码');
    return;
  }

  if (code.length !== 6) {
    ElMessage.warning('匹配码应为6位字符');
    return;
  }

  // 创建会话令牌并跳转
  const sessionToken = createSessionToken(code);
  router.push(`/room/${sessionToken}`);
}
</script>

<style scoped>
.landing-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: #e9eef3;
}
.main-content {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  max-width: 400px;
  width: 100%;
  margin: 0 auto;
}
.footer {
  width: 100%;
  text-align: center;
  padding: 10px 0;
  color: #909399;
  font-size: 12px;
}
.box-card {
  border-radius: 12px;
}
.card-header {
  text-align: center;
  font-size: 1.5rem;
  font-weight: bold;
}
.subtitle {
  font-size: 12px;
  color: #909399;
  font-weight: normal;
  margin-top: 5px;
}
.action-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 15px;
}
.join-section {
  display: flex;
  width: 100%;
  gap: 10px;
}
</style>