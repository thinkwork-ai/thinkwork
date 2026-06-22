FROM public.ecr.aws/lambda/python:3.12

ARG SKILLSPECTOR_REF=a5092dd9b9521ff57a9b53612bb129ce78019002

RUN dnf install -y git gcc gcc-c++ make && \
    dnf clean all && \
    python -m pip install --no-cache-dir --upgrade pip && \
    python -m pip install --no-cache-dir \
      "git+https://github.com/NVIDIA/SkillSpector.git@${SKILLSPECTOR_REF}"

COPY src/handler.py ${LAMBDA_TASK_ROOT}/handler.py

ENV SKILLSPECTOR_LOG_LEVEL=WARNING

CMD ["handler.handler"]
