FROM ghcr.io/puppeteer/puppeteer:latest

USER root

# Configurar diretório de trabalho
WORKDIR /usr/src/app

# Copiar arquivos de dependências
COPY package*.json ./

# Instalar dependências
RUN npm install

# Copiar todos os arquivos do projeto
COPY . .

# Ajustar permissões para garantir que o cache do whatsapp-web.js funcione
RUN chmod -R 777 /usr/src/app

# Expor a porta 3000
EXPOSE 3000

# Definir comando de inicialização
CMD ["node", "index.js"]
