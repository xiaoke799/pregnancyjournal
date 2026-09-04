<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import appIcon from "./assets/app-icon.png";

type HealthResponse = {
  ok: boolean;
  data: {
    service: string;
    runtime: string;
    accessMode: "gateway" | "port";
    gatewayPrefix: string;
    port: number | null;
  };
};

type ConfigResponse = {
  ok: boolean;
  data: {
    appName: string;
    appTitle: string;
    accessMode: "gateway" | "port";
    gatewayPrefix: string;
    appPort: number | null;
    logLevel: string;
  };
};

type SystemResponse = {
  ok: boolean;
  data: {
    appName: string;
    appTitle: string;
    accessMode: "gateway" | "port";
    gatewayPrefix: string;
    appPort: number | null;
    runtime: string;
    nodePlatform: string;
    nodeArch: string;
    processUptimeSec: number;
  };
};

type SessionResponse = {
  ok: boolean;
  data: {
    authenticated: boolean;
    uid: string | null;
    username: string | null;
    isAdmin: boolean;
  };
};

const loading = ref(true);
const error = ref("");
const health = ref<HealthResponse["data"] | null>(null);
const config = ref<ConfigResponse["data"] | null>(null);
const system = ref<SystemResponse["data"] | null>(null);
const session = ref<SessionResponse["data"] | null>(null);
const apiBase = new URL("./api/", window.location.href);

function apiUrl(path: string) {
  return new URL(path.replace(/^\//, ""), apiBase).toString();
}

const cards = computed(() => [
  {
    label: "Runtime",
    value: system.value?.runtime || "Nitro"
  },
  {
    label: "Access",
    value: config.value?.accessMode === "gateway" ? "fnOS Gateway" : "Local Port"
  },
  {
    label: "Log Level",
    value: config.value?.logLevel || "-"
  },
  {
    label: "Platform",
    value: system.value ? `${system.value.nodePlatform} / ${system.value.nodeArch}` : "-"
  }
]);

async function loadData() {
  loading.value = true;
  error.value = "";

  try {
    const [healthRes, configRes, systemRes, sessionRes] = await Promise.all([
      fetch(apiUrl("health")),
      fetch(apiUrl("config")),
      fetch(apiUrl("system")),
      fetch(apiUrl("session"))
    ]);

    if (!healthRes.ok || !configRes.ok || !systemRes.ok || !sessionRes.ok) {
      throw new Error("接口请求失败");
    }

    const [healthJson, configJson, systemJson, sessionJson] = await Promise.all([
      healthRes.json() as Promise<HealthResponse>,
      configRes.json() as Promise<ConfigResponse>,
      systemRes.json() as Promise<SystemResponse>,
      sessionRes.json() as Promise<SessionResponse>
    ]);

    health.value = healthJson.data;
    config.value = configJson.data;
    system.value = systemJson.data;
    session.value = sessionJson.data;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void loadData();
});
</script>

<template>
  <main class="shell">
    <section class="hero">
      <div class="hero-copy">
        <span class="eyebrow">FNOS NATIVE + VUE 3</span>
        <h1>{{ config?.appTitle || "fnOS App Template" }}</h1>
        <p>
          现在这个模板已经切成了更适合继续开发的结构：Vue 3 负责页面，Nitro 负责 API 和
          fnOS 打包发布，并通过统一网关复用 NAS 登录态。后面写页面就直接在
          <code>packages/ui/src</code> 里扩展。
        </p>
        <div class="actions">
          <a class="action primary" :href="apiUrl('health')" target="_blank" rel="noreferrer">健康检查</a>
          <a class="action" :href="apiUrl('system')" target="_blank" rel="noreferrer">系统信息</a>
          <button class="action ghost" type="button" @click="loadData">刷新状态</button>
        </div>
      </div>

      <div class="hero-preview">
        <div class="preview-card">
          <img class="preview-icon" :src="appIcon" alt="app icon" />
          <div>
            <strong>{{ config?.appName || "fnos-app-template" }}</strong>
            <p>{{ config?.gatewayPrefix || "/app/fnos-app-template" }}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="status-grid">
      <article v-for="card in cards" :key="card.label" class="status-card">
        <span>{{ card.label }}</span>
        <strong>{{ card.value }}</strong>
      </article>
    </section>

    <section class="panel">
      <header class="panel-header">
        <h2>开发结构</h2>
        <span>推荐从这里继续</span>
      </header>

      <div class="panel-grid">
        <div class="panel-item">
          <h3>页面目录</h3>
          <p><code>packages/ui/src</code> 放 Vue 页面、组件、样式和静态资源。</p>
        </div>
        <div class="panel-item">
          <h3>接口目录</h3>
          <p><code>packages/server/routes/api</code> 继续放 Nitro API 路由。</p>
        </div>
        <div class="panel-item">
          <h3>打包目录</h3>
          <p><code>scripts/prepare-package.mjs</code> 负责生成并校验 fnOS 产物。</p>
        </div>
        <div class="panel-item">
          <h3>开发命令</h3>
          <p><code>npm run dev</code> 同时启动 Vue 前端和 Nitro 服务。</p>
        </div>
      </div>
    </section>

    <section class="panel">
      <header class="panel-header">
        <h2>实时状态</h2>
        <span>来自现有 API</span>
      </header>

      <div v-if="loading" class="feedback">正在读取应用状态...</div>
      <div v-else-if="error" class="feedback error">{{ error }}</div>
      <pre v-else class="response">{{ { health, config, system, session } }}</pre>
    </section>
  </main>
</template>
