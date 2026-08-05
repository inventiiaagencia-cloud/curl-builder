export const catalog = [
  {
    product: "Evolution API",
    service: "WhatsApp",
    method: "POST",
    path: "/instance/create",
    authHeader: "apikey",
    bodyType: "json",
    title: "Create Instance",
    description: "Cria uma nova instância WhatsApp.",
    keywords: ["criar instancia", "create instance", "nova instancia", "whatsapp"],
    pathExample: "http://localhost:8080/instance/create",
    curlBody: `{
  "instanceName": "minha-instancia",
  "integration": "WHATSAPP-BAILEYS",
  "qrcode": true
}`,
    n8n: {
      method: "POST",
      url: "http://localhost:8080/instance/create",
      headers: {
        "Content-Type": "application/json",
        apikey: "{{ $env.EVOLUTION_API_KEY }}"
      },
      bodyMode: "json"
    }
  },
  {
    product: "Evolution API",
    service: "WhatsApp",
    method: "GET",
    path: "/instance/connect/{instanceName}",
    authHeader: "apikey",
    bodyType: "none",
    title: "Connect Instance",
    description: "Gera QR code / pairing da instância.",
    keywords: ["conectar instancia", "qr code", "pairing", "instance connect"],
    pathExample: "http://localhost:8080/instance/connect/minha-instancia",
    curlBody: "",
    n8n: {
      method: "GET",
      url: "http://localhost:8080/instance/connect/{{ $json.instanceName }}",
      headers: {
        apikey: "{{ $env.EVOLUTION_API_KEY }}"
      },
      bodyMode: "none"
    }
  },
  {
    product: "Evolution API",
    service: "WhatsApp",
    method: "POST",
    path: "/message/sendText/{instanceName}",
    authHeader: "apikey",
    bodyType: "json",
    title: "Send Text Message",
    description: "Envia mensagem de texto.",
    keywords: ["enviar texto", "mensagem texto", "send text", "texto whatsapp"],
    pathExample: "http://localhost:8080/message/sendText/minha-instancia",
    curlBody: `{
  "number": "5511999999999",
  "textMessage": {
    "text": "Olá, tudo bem?"
  }
}`,
    n8n: {
      method: "POST",
      url: "http://localhost:8080/message/sendText/{{ $json.instanceName }}",
      headers: {
        "Content-Type": "application/json",
        apikey: "{{ $env.EVOLUTION_API_KEY }}"
      },
      bodyMode: "json"
    }
  },
  {
    product: "Evolution API",
    service: "WhatsApp",
    method: "POST",
    path: "/message/sendMedia/{instanceName}",
    authHeader: "apikey",
    bodyType: "multipart",
    title: "Send Media Message",
    description: "Envia imagem, vídeo, áudio ou documento.",
    keywords: ["enviar imagem", "enviar midia", "send media", "upload whatsapp"],
    pathExample: "http://localhost:8080/message/sendMedia/minha-instancia",
    curlBody: `number=5511999999999
mediatype=image
media=@imagem.jpg
caption=Legenda
fileName=imagem.jpg`,
    n8n: {
      method: "POST",
      url: "http://localhost:8080/message/sendMedia/{{ $json.instanceName }}",
      headers: {
        apikey: "{{ $env.EVOLUTION_API_KEY }}"
      },
      bodyMode: "formData"
    }
  },
  {
    product: "Evolution API",
    service: "WhatsApp",
    method: "POST",
    path: "/message/sendLocation/{instanceName}",
    authHeader: "apikey",
    bodyType: "json",
    title: "Send Location",
    description: "Envia localização.",
    keywords: ["enviar localizacao", "send location", "mapa"],
    pathExample: "http://localhost:8080/message/sendLocation/minha-instancia",
    curlBody: `{
  "number": "5511999999999",
  "latitude": -23.5505,
  "longitude": -46.6333,
  "name": "São Paulo",
  "address": "Centro"
}`,
    n8n: {
      method: "POST",
      url: "http://localhost:8080/message/sendLocation/{{ $json.instanceName }}",
      headers: {
        "Content-Type": "application/json",
        apikey: "{{ $env.EVOLUTION_API_KEY }}"
      },
      bodyMode: "json"
    }
  },
  {
    product: "Evolution API",
    service: "WhatsApp",
    method: "POST",
    path: "/message/sendContact/{instanceName}",
    authHeader: "apikey",
    bodyType: "json",
    title: "Send Contact",
    description: "Envia cartão de contato.",
    keywords: ["enviar contato", "send contact", "vcard"],
    pathExample: "http://localhost:8080/message/sendContact/minha-instancia",
    curlBody: `{
  "number": "5511999999999",
  "contacts": [
    {
      "displayName": "Contato Exemplo",
      "contacts": [{}]
    }
  ]
}`,
    n8n: {
      method: "POST",
      url: "http://localhost:8080/message/sendContact/{{ $json.instanceName }}",
      headers: {
        "Content-Type": "application/json",
        apikey: "{{ $env.EVOLUTION_API_KEY }}"
      },
      bodyMode: "json"
    }
  },
  {
    product: "Evolution API",
    service: "WhatsApp",
    method: "POST",
    path: "/message/sendButtons/{instanceName}",
    authHeader: "apikey",
    bodyType: "json",
    title: "Send Buttons",
    description: "Envia botões interativos.",
    keywords: ["enviar botoes", "send buttons", "interativo"],
    pathExample: "http://localhost:8080/message/sendButtons/minha-instancia",
    curlBody: `{
  "number": "5511999999999",
  "text": "Escolha uma opção",
  "footerText": "Rodapé",
  "buttons": [
    {
      "buttonId": "opcao_1",
      "buttonText": { "displayText": "Opção 1" }
    }
  ]
}`,
    n8n: {
      method: "POST",
      url: "http://localhost:8080/message/sendButtons/{{ $json.instanceName }}",
      headers: {
        "Content-Type": "application/json",
        apikey: "{{ $env.EVOLUTION_API_KEY }}"
      },
      bodyMode: "json"
    }
  },
  {
    product: "Evolution API",
    service: "WhatsApp",
    method: "POST",
    path: "/message/sendList/{instanceName}",
    authHeader: "apikey",
    bodyType: "json",
    title: "Send List",
    description: "Envia lista interativa.",
    keywords: ["enviar lista", "send list", "menu"],
    pathExample: "http://localhost:8080/message/sendList/minha-instancia",
    curlBody: `{
  "number": "5511999999999",
  "title": "Menu",
  "description": "Escolha uma opção",
  "buttonText": "Abrir",
  "sections": [
    {
      "title": "Opções",
      "rows": [
        { "title": "Vendas", "rowId": "vendas" }
      ]
    }
  ]
}`,
    n8n: {
      method: "POST",
      url: "http://localhost:8080/message/sendList/{{ $json.instanceName }}",
      headers: {
        "Content-Type": "application/json",
        apikey: "{{ $env.EVOLUTION_API_KEY }}"
      },
      bodyMode: "json"
    }
  },
  {
    product: "Evolution API",
    service: "WhatsApp",
    method: "POST",
    path: "/message/sendPoll/{instanceName}",
    authHeader: "apikey",
    bodyType: "json",
    title: "Send Poll",
    description: "Envia enquete.",
    keywords: ["enviar enquete", "send poll", "votacao"],
    pathExample: "http://localhost:8080/message/sendPoll/minha-instancia",
    curlBody: `{
  "number": "5511999999999",
  "name": "Qual opção?",
  "selectableCount": 1,
  "values": ["A", "B", "C"]
}`,
    n8n: {
      method: "POST",
      url: "http://localhost:8080/message/sendPoll/{{ $json.instanceName }}",
      headers: {
        "Content-Type": "application/json",
        apikey: "{{ $env.EVOLUTION_API_KEY }}"
      },
      bodyMode: "json"
    }
  },
  {
    product: "Evolution API",
    service: "WhatsApp",
    method: "POST",
    path: "/message/sendReaction/{instanceName}",
    authHeader: "apikey",
    bodyType: "json",
    title: "Send Reaction",
    description: "Envia reação a mensagem.",
    keywords: ["reagir", "send reaction", "emoji"],
    pathExample: "http://localhost:8080/message/sendReaction/minha-instancia",
    curlBody: `{
  "reactionKey": {},
  "reactionMessage": "👍"
}`,
    n8n: {
      method: "POST",
      url: "http://localhost:8080/message/sendReaction/{{ $json.instanceName }}",
      headers: {
        "Content-Type": "application/json",
        apikey: "{{ $env.EVOLUTION_API_KEY }}"
      },
      bodyMode: "json"
    }
  },
  {
    product: "Evolution API",
    service: "WhatsApp",
    method: "POST",
    path: "/webhook/instance",
    authHeader: "apikey",
    bodyType: "json",
    title: "Configure Webhook",
    description: "Configura webhook por instância.",
    keywords: ["webhook evolution api", "configurar webhook"],
    pathExample: "http://localhost:8080/webhook/instance",
    curlBody: `{
  "url": "https://seu-webhook.com",
  "webhook_by_events": false,
  "webhook_base64": false,
  "events": ["QRCODE_UPDATED", "MESSAGES_UPSERT"]
}`,
    n8n: {
      method: "POST",
      url: "http://localhost:8080/webhook/instance",
      headers: {
        "Content-Type": "application/json",
        apikey: "{{ $env.EVOLUTION_API_KEY }}"
      },
      bodyMode: "json"
    }
  },
  {
    product: "Evolution Go",
    service: "WhatsApp",
    method: "POST",
    path: "/send/text",
    authHeader: "apikey",
    bodyType: "json",
    title: "Send Text",
    description: "Envia texto via Evolution Go.",
    keywords: ["go enviar texto", "send text go"],
    pathExample: "http://localhost:8080/send/text",
    curlBody: `{
  "number": "5511999999999",
  "text": "Olá",
  "delay": 0
}`,
    n8n: {
      method: "POST",
      url: "http://localhost:8080/send/text",
      headers: {
        "Content-Type": "application/json"
      },
      bodyMode: "json"
    }
  },
  {
    product: "Evolution Go",
    service: "WhatsApp",
    method: "POST",
    path: "/send/media",
    authHeader: "none",
    bodyType: "json",
    title: "Send Media",
    description: "Envia mídia por URL no Evolution Go.",
    keywords: ["go imagem", "go midia", "send media go"],
    pathExample: "http://localhost:8080/send/media",
    curlBody: `{
  "number": "5511999999999",
  "url": "https://exemplo.com/imagem.jpg",
  "type": "image",
  "caption": "Legenda"
}`,
    n8n: {
      method: "POST",
      url: "http://localhost:8080/send/media",
      headers: {
        "Content-Type": "application/json"
      },
      bodyMode: "json"
    }
  },
  {
    product: "Evolution Go",
    service: "WhatsApp",
    method: "POST",
    path: "/send/location",
    authHeader: "none",
    bodyType: "json",
    title: "Send Location",
    description: "Envia localização.",
    keywords: ["go localizacao", "send location go"],
    pathExample: "http://localhost:8080/send/location",
    curlBody: `{
  "number": "5511999999999",
  "latitude": -23.5505,
  "longitude": -46.6333,
  "name": "São Paulo",
  "address": "Centro"
}`,
    n8n: {
      method: "POST",
      url: "http://localhost:8080/send/location",
      headers: {
        "Content-Type": "application/json"
      },
      bodyMode: "json"
    }
  },
  {
    product: "Evolution Go",
    service: "WhatsApp",
    method: "POST",
    path: "/send/contact",
    authHeader: "none",
    bodyType: "json",
    title: "Send Contact",
    description: "Envia contato.",
    keywords: ["go contato", "send contact go"],
    pathExample: "http://localhost:8080/send/contact",
    curlBody: `{
  "number": "5511999999999",
  "vcard": {
    "fullName": "Contato Exemplo",
    "organization": "Empresa",
    "phone": "5511999999999"
  }
}`,
    n8n: {
      method: "POST",
      url: "http://localhost:8080/send/contact",
      headers: {
        "Content-Type": "application/json"
      },
      bodyMode: "json"
    }
  },
  {
    product: "Evolution Go",
    service: "WhatsApp",
    method: "POST",
    path: "/send/link",
    authHeader: "none",
    bodyType: "json",
    title: "Send Link",
    description: "Envia card de link.",
    keywords: ["go link", "send link go"],
    pathExample: "http://localhost:8080/send/link",
    curlBody: `{
  "number": "5511999999999",
  "url": "https://exemplo.com",
  "title": "Título",
  "description": "Descrição",
  "text": "Veja este link"
}`,
    n8n: {
      method: "POST",
      url: "http://localhost:8080/send/link",
      headers: {
        "Content-Type": "application/json"
      },
      bodyMode: "json"
    }
  },
  {
    product: "Evolution Go",
    service: "WhatsApp",
    method: "POST",
    path: "/send/sticker",
    authHeader: "none",
    bodyType: "json",
    title: "Send Sticker",
    description: "Envia sticker.",
    keywords: ["go sticker", "send sticker go"],
    pathExample: "http://localhost:8080/send/sticker",
    curlBody: `{
  "number": "5511999999999",
  "sticker": "https://exemplo.com/sticker.webp"
}`,
    n8n: {
      method: "POST",
      url: "http://localhost:8080/send/sticker",
      headers: {
        "Content-Type": "application/json"
      },
      bodyMode: "json"
    }
  },
  {
    product: "Evolution Go",
    service: "WhatsApp",
    method: "POST",
    path: "/send/poll",
    authHeader: "none",
    bodyType: "json",
    title: "Send Poll",
    description: "Envia enquete.",
    keywords: ["go enquete", "send poll go"],
    pathExample: "http://localhost:8080/send/poll",
    curlBody: `{
  "number": "5511999999999",
  "question": "Qual opção?",
  "options": ["A", "B", "C"],
  "maxAnswer": 1
}`,
    n8n: {
      method: "POST",
      url: "http://localhost:8080/send/poll",
      headers: {
        "Content-Type": "application/json"
      },
      bodyMode: "json"
    }
  },
  {
    product: "Evolution Go",
    service: "WhatsApp",
    method: "POST",
    path: "/instance/connect",
    authHeader: "apikey",
    bodyType: "json",
    title: "Connect to Instance",
    description: "Conecta instância com webhook.",
    keywords: ["go conectar webhook", "connect instance go"],
    pathExample: "http://localhost:8080/instance/connect",
    curlBody: `{
  "webhookUrl": "https://seu-webhook.com",
  "subscribe": ["ALL"],
  "immediate": true
}`,
    n8n: {
      method: "POST",
      url: "http://localhost:8080/instance/connect",
      headers: {
        "Content-Type": "application/json",
        apikey: "{{ $env.EVOLUTION_GO_KEY }}"
      },
      bodyMode: "json"
    }
  },
  {
    product: "Evo CRM",
    service: "CRM",
    method: "POST",
    path: "/api/v1/contacts",
    authHeader: "api_access_token",
    bodyType: "json",
    title: "Create Contact",
    description: "Cria um contato no CRM.",
    keywords: ["criar contato crm", "create contact", "contato evo crm"],
    pathExample: "https://api.evoai.app/api/v1/contacts",
    curlBody: `{
  "name": "Maria Santos",
  "email": "maria@exemplo.com",
  "phone_number": "+5521999999999",
  "labels": ["lead"]
}`,
    n8n: {
      method: "POST",
      url: "https://api.evoai.app/api/v1/contacts",
      headers: {
        "Content-Type": "application/json",
        api_access_token: "{{ $env.EVO_CRM_TOKEN }}"
      },
      bodyMode: "json"
    }
  },
  {
    product: "Evo CRM",
    service: "CRM",
    method: "GET",
    path: "/api/v1/contacts/search",
    authHeader: "api_access_token",
    bodyType: "none",
    title: "Search Contacts",
    description: "Busca contatos por texto.",
    keywords: ["buscar contatos", "search contacts", "crm search"],
    pathExample: "https://api.evoai.app/api/v1/contacts/search?q=maria",
    curlBody: "",
    n8n: {
      method: "GET",
      url: "https://api.evoai.app/api/v1/contacts/search?q={{ $json.q }}",
      headers: {
        api_access_token: "{{ $env.EVO_CRM_TOKEN }}"
      },
      bodyMode: "none"
    }
  },
  {
    product: "Evo CRM",
    service: "CRM",
    method: "POST",
    path: "/api/v1/contacts/filter",
    authHeader: "api_access_token",
    bodyType: "json",
    title: "Filter Contacts",
    description: "Filtra contatos com operadores.",
    keywords: ["filtrar contatos", "contact filter"],
    pathExample: "https://api.evoai.app/api/v1/contacts/filter",
    curlBody: `{
  "payload": [
    {
      "attribute_key": "name",
      "filter_operator": "equal_to",
      "values": ["Maria"],
      "query_operator": "AND"
    }
  ]
}`,
    n8n: {
      method: "POST",
      url: "https://api.evoai.app/api/v1/contacts/filter",
      headers: {
        "Content-Type": "application/json",
        api_access_token: "{{ $env.EVO_CRM_TOKEN }}"
      },
      bodyMode: "json"
    }
  },
  {
    product: "Evo CRM",
    service: "CRM",
    method: "GET",
    path: "/api/v1/conversations",
    authHeader: "api_access_token",
    bodyType: "none",
    title: "List Conversations",
    description: "Lista conversas com paginação.",
    keywords: ["listar conversas", "conversations list", "crm conversations"],
    pathExample: "https://api.evoai.app/api/v1/conversations?status=open&page=1",
    curlBody: "",
    n8n: {
      method: "GET",
      url: "https://api.evoai.app/api/v1/conversations?status={{ $json.status }}&page={{ $json.page }}",
      headers: {
        api_access_token: "{{ $env.EVO_CRM_TOKEN }}"
      },
      bodyMode: "none"
    }
  },
  {
    product: "Evo CRM",
    service: "CRM",
    method: "GET",
    path: "/api/v1/conversations/{conversation_id}",
    authHeader: "api_access_token",
    bodyType: "none",
    title: "Conversation Details",
    description: "Detalha uma conversa.",
    keywords: ["detalhe conversa", "conversation details", "abrir conversa"],
    pathExample: "https://api.evoai.app/api/v1/conversations/CONVERSATION_ID",
    curlBody: "",
    n8n: {
      method: "GET",
      url: "https://api.evoai.app/api/v1/conversations/{{ $json.conversation_id }}",
      headers: {
        api_access_token: "{{ $env.EVO_CRM_TOKEN }}"
      },
      bodyMode: "none"
    }
  },
  {
    product: "Evo CRM",
    service: "CRM",
    method: "POST",
    path: "/api/v1/conversations/{conversation_id}/messages",
    authHeader: "api_access_token",
    bodyType: "json",
    title: "Create Message",
    description: "Cria mensagem na conversa.",
    keywords: ["mensagem crm", "create message", "reply conversation"],
    pathExample: "https://api.evoai.app/api/v1/conversations/CONVERSATION_ID/messages",
    curlBody: `{
  "content": "Olá, como posso ajudar?",
  "message_type": "outgoing",
  "content_type": "text"
}`,
    n8n: {
      method: "POST",
      url: "https://api.evoai.app/api/v1/conversations/{{ $json.conversation_id }}/messages",
      headers: {
        "Content-Type": "application/json",
        api_access_token: "{{ $env.EVO_CRM_TOKEN }}"
      },
      bodyMode: "json"
    }
  },
  {
    product: "Evo CRM",
    service: "CRM",
    method: "POST",
    path: "/api/v1/pipelines",
    authHeader: "api_access_token",
    bodyType: "json",
    title: "Create Pipeline",
    description: "Cria pipeline no CRM.",
    keywords: ["criar pipeline", "new pipeline", "sales pipeline"],
    pathExample: "https://api.evoai.app/api/v1/pipelines",
    curlBody: `{
  "pipeline": {
    "name": "Sales Pipeline",
    "pipeline_type": "sales",
    "visibility": "private"
  },
  "create_default_stages": true
}`,
    n8n: {
      method: "POST",
      url: "https://api.evoai.app/api/v1/pipelines",
      headers: {
        "Content-Type": "application/json",
        api_access_token: "{{ $env.EVO_CRM_TOKEN }}"
      },
      bodyMode: "json"
    }
  },
  {
    product: "Evo CRM",
    service: "CRM",
    method: "POST",
    path: "/api/v1/pipelines/{pipeline_id}/pipeline_items",
    authHeader: "api_access_token",
    bodyType: "json",
    title: "Add Item to Pipeline",
    description: "Adiciona item ao pipeline.",
    keywords: ["pipeline item", "add deal", "lead pipeline"],
    pathExample: "https://api.evoai.app/api/v1/pipelines/PIPELINE_ID/pipeline_items",
    curlBody: `{
  "item_id": "ITEM_ID",
  "pipeline_stage_id": "STAGE_ID",
  "custom_fields": {}
}`,
    n8n: {
      method: "POST",
      url: "https://api.evoai.app/api/v1/pipelines/{{ $json.pipeline_id }}/pipeline_items",
      headers: {
        "Content-Type": "application/json",
        api_access_token: "{{ $env.EVO_CRM_TOKEN }}"
      },
      bodyMode: "json"
    }
  },
  {
    product: "Evo CRM",
    service: "CRM",
    method: "GET",
    path: "/api/v1/products",
    authHeader: "api_access_token",
    bodyType: "none",
    title: "List Products",
    description: "Lista produtos do catálogo.",
    keywords: ["listar produtos", "crm products"],
    pathExample: "https://api.evoai.app/api/v1/products?page=1",
    curlBody: "",
    n8n: {
      method: "GET",
      url: "https://api.evoai.app/api/v1/products?page={{ $json.page }}",
      headers: {
        api_access_token: "{{ $env.EVO_CRM_TOKEN }}"
      },
      bodyMode: "none"
    }
  }
];

export const products = [...new Set(catalog.map((item) => item.product))];
