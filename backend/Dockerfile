FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --create-home zhixing && mkdir /data && chown zhixing:zhixing /data
COPY app.py ./
USER zhixing
ENV ZHIXING_DB=/data/zhixing.sqlite3
EXPOSE 8000
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "2", "--threads", "4", "--timeout", "30", "app:create_app()"]
