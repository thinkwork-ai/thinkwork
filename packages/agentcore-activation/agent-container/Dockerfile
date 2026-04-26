FROM public.ecr.aws/lambda/python:3.12-arm64

WORKDIR /var/task

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY container-sources/ ./

ENV PORT=8080
CMD ["server.handler"]
